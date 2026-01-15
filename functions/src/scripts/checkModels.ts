
import { VertexAI } from '@google-cloud/vertexai';

const project = 'profit-step';
const location = 'us-central1';

async function listModels() {
    console.log(`Checking models for project: ${project} in ${location}...`);
    try {
        const vertexAI = new VertexAI({ project, location });
        // const generativeModel = vertexAI.preview.getGenerativeModel({
        //     model: 'gemini-1.5-flash-001'
        // });

        // Try a simple generation to see if it works, as listing models via this SDK is not directly straightforward 
        // without the specific model service client.
        // Instead, we will try to just generate content with a "safe" model name to check connection.

        console.log("Attempting generation with gemini-1.0-pro...");
        const model1 = vertexAI.preview.getGenerativeModel({ model: 'gemini-1.0-pro' });
        const resp1 = await model1.generateContent('Hello');
        console.log("Gemini 1.0 Pro Success:", JSON.stringify(resp1));

    } catch (error: any) {
        console.error("Error with gemini-1.0-pro:", error.message);
    }

    try {
        console.log("Attempting generation with gemini-1.5-flash-001...");
        const vertexAI = new VertexAI({ project, location });
        const model2 = vertexAI.preview.getGenerativeModel({ model: 'gemini-1.5-flash-001' });
        const resp2 = await model2.generateContent('Hello');
        console.log("Gemini 1.5 Flash 001 Success:", JSON.stringify(resp2));
    } catch (error: any) {
        console.error("Error with gemini-1.5-flash-001:", error.message);
    }

    try {
        console.log("Attempting generation with gemini-1.5-flash-002...");
        const vertexAI = new VertexAI({ project, location });
        const model3 = vertexAI.preview.getGenerativeModel({ model: 'gemini-1.5-flash-002' });
        const resp3 = await model3.generateContent('Hello');
        console.log("Gemini 1.5 Flash 002 Success:", JSON.stringify(resp3));
    } catch (error: any) {
        console.error("Error with gemini-1.5-flash-002:", error.message);
    }
}

listModels();
