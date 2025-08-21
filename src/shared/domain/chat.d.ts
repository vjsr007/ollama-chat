export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    imagePath?: string;
}
export interface ChatRequest {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
}
