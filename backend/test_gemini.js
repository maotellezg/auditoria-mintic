import { VertexAI } from '@google-cloud/vertexai';
import dotenv from 'dotenv';
dotenv.config();

const projectId = 'auditoria-mintc';
const location = 'us-central1';

const vertexAI = new VertexAI({
  project: projectId,
  location: location
});

async function testModel(modelName) {
  try {
    console.log(`Testing model: ${modelName}...`);
    const model = vertexAI.getGenerativeModel({
      model: modelName,
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Hola, di test' }] }]
    });
    const response = await result.response;
    console.log(`✅ Success for ${modelName}! Response: ${response.text.trim()}`);
    return true;
  } catch (error) {
    console.log(`❌ Failed for ${modelName}: ${error.message}`);
    return false;
  }
}

async function main() {
  const models = [
    'gemini-1.5-flash-001',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    'gemini-1.5-pro-001',
    'gemini-1.5-pro-002',
    'gemini-1.5-pro',
  ];
  for (const m of models) {
    await testModel(m);
  }
}

main();
