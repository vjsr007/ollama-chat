#!/usr/bin/env python3
"""
Simple Whisper transcription server
Compatible with OpenAI API format
"""

import os
import tempfile
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import whisper

app = Flask(__name__)
CORS(app)

# Load Whisper model (using base model for speed, can be changed to large for accuracy)
print("Loading Whisper model...")
model = whisper.load_model("base")
print("Whisper model loaded successfully!")

@app.route('/v1/audio/transcriptions', methods=['POST'])
def transcribe():
    try:
        # Check if file is in request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Get language from request (optional)
        language = request.form.get('language', None)
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name
        
        try:
            # Transcribe using Whisper
            print(f"Transcribing file: {tmp_path}, language: {language}")
            
            result = model.transcribe(
                tmp_path,
                language=language if language and language != 'auto' else None,
                fp16=False  # Disable FP16 for compatibility
            )
            
            # Extract text
            text = result.get('text', '').strip()
            print(f"Transcription result: {text}")
            
            # Return in OpenAI API format
            return jsonify({
                'text': text
            })
            
        finally:
            # Clean up temporary file
            try:
                os.unlink(tmp_path)
            except:
                pass
    
    except Exception as e:
        print(f"Transcription error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'service': 'whisper-transcription'})

@app.route('/', methods=['GET'])
def root():
    return jsonify({
        'service': 'Whisper Transcription Server',
        'endpoints': {
            'transcribe': '/v1/audio/transcriptions (POST)',
            'health': '/health (GET)'
        }
    })

if __name__ == '__main__':
    print("Starting Whisper Transcription Server...")
    print("Server will be available at: http://localhost:9000")
    print("Health check: http://localhost:9000/health")
    print("Transcription endpoint: http://localhost:9000/v1/audio/transcriptions")
    
    app.run(host='0.0.0.0', port=9000, debug=False)
