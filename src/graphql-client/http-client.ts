import { DocumentNode, print } from 'graphql';
import fetch, { Request, Response } from 'node-fetch';
import { ClientExecutionResult } from './client-execution-result';
import { mapErrorLocations } from './error-location-helper';
import { GraphQLClient } from './graphql-client';
import TraceError = require('trace-error');

export class HttpGraphQLClient implements GraphQLClient {
    public readonly url: string;

    constructor(config: { url: string }) {
        this.url = config.url;
    }

    async execute(document: DocumentNode, variables?: { [name: string]: any }, context?: any, introspect?: boolean) {
        let res;
        try {
            res = await this.fetchResponse(document, variables, context, introspect);
        } catch (error) {
            throw new TraceError(`Error connecting to GraphQL endpoint at ${this.url}: ${error.message}`, error);
        }
        if (!res.ok) {
            if (res.headers.get('Content-Type') == 'application/json') {
                // try to parse for a GraphQL response with errors
                let json;
                try {
                    json = await res.json();
                    if (json && typeof json == 'object' && json.errors && typeof json.errors == 'object' && json.errors.length) {
                        // only if we got what seems like a proper unsuccessful GraphQL result, use this. Otherwise, fall back to error message
                        return await this.processResponse(json, document, variables, context, introspect);
                    }
                } catch (error) {
                    // fall through
                }
            }

            throw new Error(`GraphQL endpoint at ${this.url} reported ${res.status} ${res.statusText}`);
        }

        let json;
        try {
            json = await res.json();
        } catch (error) {
            throw new TraceError(`Response from GraphQL endpoint at ${this.url} is invalid json: ${error.message}`, error);
        }
        if (typeof json != 'object') {
            throw new Error(`Response from GraphQL endpoint at ${this.url} is not an object`);
        }
        return await this.processResponse(json, document, variables, context, introspect);
    }

    protected async fetchResponse(document: DocumentNode, variables?: { [name: string]: any }, context?: any, introspect?: boolean): Promise<Response> {
        return this.fetch(await this.getRequest(document, variables, context, introspect));
    }

    protected fetch = fetch;

    protected async getRequest(document: DocumentNode, variables?: { [name: string]: any }, context?: any, introspect?: boolean): Promise<Request> {
        return new Request(this.url, {
            method: 'POST',
            headers: await this.getHeaders(document, variables, context, introspect),
            body: await this.getBody(document, variables, context)
        });
    }

    protected async getHeaders(document: DocumentNode, variables?: { [name: string]: any }, context?: any, introspect?: boolean): Promise<{ [index: string]: string }> {
        return {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        };
    }

    protected async getBody(document: DocumentNode, variables?: { [name: string]: any }, context?: any, introspect?: boolean): Promise<any> {
        return JSON.stringify({
            query: print(document),
            variables
        });
    }

    protected async processResponse(response: ClientExecutionResult, document: DocumentNode, variables?: { [name: string]: any }, context?: any, introspect?: boolean): Promise<ClientExecutionResult> {
        return mapErrorLocations(response, document);
    }
}
