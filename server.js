const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const port = process.env.PORT || 3000;

// Multer setup to store uploaded files in memory
const upload = multer({ storage: multer.memoryStorage() });

// Serve static frontend files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize the Gemini SDK
const api_key = process.env.GEMINI_API_KEY;
if (!api_key) {
    console.error("CRITICAL: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(api_key);

const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
    console.warn("WARNING: APP_PASSWORD is not set. Anyone can use your API!");
}

// Limit each IP to 10 requests per 15 minutes
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
    message: { error: 'Too many requests created from this IP, please try again after 15 minutes.' },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the rate limiting middleware strictly to API calls
app.use('/api/analyze', apiLimiter);
// --------------------------------------

// Define the structured output schema natively
const receiptSchema = {
    type: SchemaType.OBJECT,
    properties: {
        store_name: { type: SchemaType.STRING },
        date: { type: SchemaType.STRING },
        time: { type: SchemaType.STRING },
        total_amount: { type: SchemaType.NUMBER },
        tax_amount: { type: SchemaType.NUMBER },
        currency: { type: SchemaType.STRING },
        items: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    description: { type: SchemaType.STRING },
                    quantity: { type: SchemaType.NUMBER },
                    price: { type: SchemaType.NUMBER },
                }
            }
        }
    }
};

// API Endpoint to process the receipt
app.post('/api/analyze', upload.single('receipt'), async (req, res) => {
    try {
        // --- SECURITY CHECK ---
        const userPassword = req.body.password;
        if (APP_PASSWORD && userPassword !== APP_PASSWORD) {
            console.log("Failed login attempt.");
            return res.status(401).json({ error: 'Unauthorized: Incorrect password.' });
        }
        // --------------------------

        if (!req.file) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const customPrompt = req.body.prompt || "Analyze this receipt carefully and extract the data.";

        // Configure the model
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: "You are an expert accounting assistant. Analyze the provided receipt image carefully. Extract the exact store name, date, time, totals, and line items. If a specific field is not visible or cannot be determined, return null. Do not guess or hallucinate data.",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: receiptSchema,
                temperature: 0.0, 
            }
        });

        // Convert memory buffer to generative part format
        const imagePart = {
            inlineData: {
                data: req.file.buffer.toString("base64"),
                mimeType: req.file.mimetype
            }
        };

        console.log("Analyzing receipt...");
        const result = await model.generateContent([customPrompt, imagePart]);
        const textResponse = result.response.text();
        
        // Parse and return the JSON
        res.json(JSON.parse(textResponse));

    } catch (error) {
        console.error("Error during analysis:", error);
        res.status(500).json({ error: 'An error occurred while parsing the receipt.' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});