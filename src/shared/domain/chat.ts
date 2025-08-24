export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  imagePath?: string; // deprecated single image path
  images?: string[];  // preferred: array of image paths / data URLs / base64
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
}
