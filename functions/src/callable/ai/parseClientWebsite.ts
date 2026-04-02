import * as functions from 'firebase-functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import * as cheerio from 'cheerio';

interface ParseClientWebsiteRequest {
    url: string;
}

interface ParseClientWebsiteResponse {
    name?: string;
    type?: string;
    phone?: string;
    email?: string;
    address?: string;
    website?: string;
}

const SYSTEM_PROMPT = `You are an expert data extractor for a CRM system. 
Your task is to analyze the provided text content extracted from a company's website and identify key business information.

Provide your response IN PURE JSON format (no markdown, no backticks) matching this structure exactly:
{
  "name": "string (The official company name or title. Not the tagline. Keep it concise.)",
  "type": "string (Either 'B2B', 'B2C', or 'Both', based on their services)",
  "phone": "string (Primary contact phone number, formatted clearly if possible)",
  "email": "string (Primary contact email address)",
  "address": "string (Full physical address if found)"
}

Only return fields you are reasonably confident in finding. If a field is not found, leave it empty or omit it. Do not invent information. Ensure the output is valid JSON.`;

/**
 * Attempts to fetch the raw text content of a given URL.
 * We use axios and cheerio to strip out scripts, styles, and html tags
 * to present clean text to the AI, reducing token usage and improving accuracy.
 */
async function fetchWebsiteText(url: string): Promise<string> {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ProfitStepBot/1.0; +http://profit-step.web.app)'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Remove unnecessary elements
        $('script, style, noscript, svg, img, video, iframe').remove();

        // Extract raw text
        let text = $('body').text();

        // Clean up whitespace
        text = text.replace(/\s+/g, ' ').trim();

        // Limit to first 15000 characters to avoid exceeding token limits
        return text.substring(0, 15000);
    } catch (error: any) {
        console.error(`Failed to fetch website content: ${error.message}`);
        throw new functions.https.HttpsError('unavailable', `Could not fetch content from ${url}. The website might be blocking scrapers or is unreachable.`);
    }
}

/**
 * Main Cloud Function for parsing a client's website to extract CRM details.
 */
export const parseClientWebsite = functions
    .runWith({
        memory: '256MB',
        timeoutSeconds: 60,
    })
    .https.onCall(async (data: ParseClientWebsiteRequest, context) => {
        // Verify authentication
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
        }

        // Validate required fields
        if (!data.url || !data.url.startsWith('http')) {
            throw new functions.https.HttpsError('invalid-argument', 'A valid URL starting with http/https is required');
        }

        console.log(`🌐 Parsing website: ${data.url}`);

        // 1. Fetch website text content
        const websiteText = await fetchWebsiteText(data.url);

        if (!websiteText || websiteText.length < 50) {
            console.warn(`Website returned too little text content.`);
            throw new functions.https.HttpsError('failed-precondition', 'Website returned too little readable content to analyze.');
        }

        // 2. Call Gemini API
        const apiKey = process.env.GEMINI_API_KEY || '';

        if (!apiKey) {
            throw new functions.https.HttpsError('failed-precondition', 'GEMINI_API_KEY not configured.');
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const models = ['gemini-2.0-flash', 'gemini-1.5-flash-latest'];
        let aiResponseText = '';
        let success = false;

        const userPrompt = `Website URL: ${data.url}\n\nWebsite Content:\n${websiteText}`;

        for (const modelName of models) {
            console.log(`🤖 Trying ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.1,
                    }
                });

                const result = await model.generateContent([
                    { text: SYSTEM_PROMPT },
                    { text: userPrompt }
                ]);

                const text = result.response.text();
                if (text) {
                    console.log(`✅ Success with ${modelName}`);
                    aiResponseText = text;
                    success = true;
                    break;
                }
            } catch (error: any) {
                console.warn(`[${modelName}] Failed: ${error.message}`);
            }
        }

        if (!success) {
            console.error('❌ All Gemini attempts failed.');
            throw new functions.https.HttpsError('internal', 'AI Data Extraction Failed. Please try manually filling the form.');
        }

        // 3. Parse JSON response
        try {
            const cleanText = aiResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsedData = JSON.parse(cleanText) as ParseClientWebsiteResponse;

            // Add the original URL back
            parsedData.website = data.url;

            console.log(`✅ Extracted data:`, parsedData);
            return parsedData;

        } catch (error: any) {
            console.error('❌ Failed to parse AI JSON response:', aiResponseText);
            throw new functions.https.HttpsError('internal', 'Failed to parse AI response into valid format.');
        }
    });
