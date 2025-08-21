export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imagePath?: string; // local path to image for vision models
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
}
