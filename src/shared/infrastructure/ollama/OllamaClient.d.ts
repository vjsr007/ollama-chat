import { ChatRequest } from '../../domain/chat';
export declare class OllamaClient {
    private baseUrl;
    constructor(baseUrl?: string);
    listModels(): Promise<string[]>;
    generate(req: ChatRequest): Promise<string>;
    private mapMessage;
}
