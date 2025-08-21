// Test para verificar la detección de JSON en resultados de herramientas
const testContent = `SYSTEM

Tool executed: puppeteer_screenshot
Result: [
{
"type": "text",
"text": "Screenshot 'undefined' taken at 800x600"
},
{
"type": "image",
"data": "iVBORw0KGgoAAAANSUhEUgAAYAAAAJYCAIAAAAVFBUnAAAAXNSR0IArs4c6QAACqpJREFUeJzt1sFJACAQwDB1/53PIQqCJBP02",
"mimeType": "image/png"
}
]`;

// Función de detección mejorada
const hasJsonContent = (text) => {
  const jsonPatterns = [
    /```json/i,
    /Tool executed:/i,
    /Result:\s*[\{\[]/i,
    /SYSTEM\s*\n.*Tool executed:/i,
    /Result:\s*\[/i,
    /^\s*[\{\[]/,
    /[\{\[].{20,}/,
    /"type":\s*"(text|image)"/i,
    /"data":\s*"/i,
    /"mimeType":\s*"/i
  ];
  
  return jsonPatterns.some(pattern => pattern.test(text));
};

console.log('Test content contains JSON:', hasJsonContent(testContent));

// Test individual patterns
const patterns = [
  /```json/i,
  /Tool executed:/i,
  /Result:\s*[\{\[]/i,
  /SYSTEM\s*\n.*Tool executed:/i,
  /Result:\s*\[/i,
  /^\s*[\{\[]/,
  /[\{\[].{20,}/,
  /"type":\s*"(text|image)"/i,
  /"data":\s*"/i,
  /"mimeType":\s*"/i
];

patterns.forEach((pattern, index) => {
  console.log(`Pattern ${index + 1}:`, pattern.test(testContent));
});
