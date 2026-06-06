const { GoogleGenAI } = require('@google/genai');

async function run() {
  const VERTEX_PROJECT = 'chat-stox';
  const VERTEX_LOCATION = 'us-central1';
  
  console.log('Initializing GoogleGenAI in Vertex mode...');
  const ai = new GoogleGenAI({
    vertexai: true,
    project: VERTEX_PROJECT,
    location: VERTEX_LOCATION,
  });

  const models = ['gemini-1.5-flash', 'gemini-1.5-flash-001', 'gemini-1.5-flash-002', 'gemini-1.5-pro', 'gemini-2.5-flash'];
  
  for (const model of models) {
    try {
      console.log(`\nTrying model: ${model}...`);
      const response = await ai.models.generateContent({
        model: model,
        contents: 'Hi',
      });
      console.log(`✅ Success with ${model}! Response:`, response.text);
      return;
    } catch (err) {
      console.error(`❌ Failed with ${model}:`, err.message);
    }
  }
}

run();
