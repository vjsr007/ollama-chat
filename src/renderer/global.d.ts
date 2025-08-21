export {};

declare global {
  interface Window {
    ollama: {
      listModels: () => Promise<string[]>;
      sendChat: (req: import('../shared/domain/chat').ChatRequest) => Promise<string>;
      openImage: () => Promise<string | null>;
    }
  }
}
