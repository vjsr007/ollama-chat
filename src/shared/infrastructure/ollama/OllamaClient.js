import axios from 'axios';
import fs from 'fs/promises';
export class OllamaClient {
    constructor(baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434') {
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }
    async listModels() {
        const { data } = await axios.get(`${this.baseUrl}/api/tags`);
        return (data.models || []).map((m) => m.name);
    }
    async generate(req) {
        // Convert messages to format expected by Ollama /api/chat
        const messages = await Promise.all(req.messages.map(m => this.mapMessage(m)));
        const { data } = await axios.post(`${this.baseUrl}/api/chat`, {
            model: req.model,
            messages,
            stream: false
        });
        return data.message?.content ?? '';
    }
    async mapMessage(m) {
        if (!m.imagePath)
            return { role: m.role, content: m.content };
        const imgBuffer = await fs.readFile(m.imagePath);
        const b64 = imgBuffer.toString('base64');
        return { role: m.role, content: m.content, images: [b64] };
    }
}
