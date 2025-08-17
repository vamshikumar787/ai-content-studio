// server.js (Updated Version)

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// --- INITIALIZATION ---

// Read Firebase service account key
const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json'));

// Initialize Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const auth = admin.auth();

const app = express();

// Configure CORS to allow frontend (e.g., http://127.0.0.1:5500)
app.use(cors({
    origin: 'http://127.0.0.1:5500', // Adjust if your frontend uses a different port
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- AUTHENTICATION MIDDLEWARE ---
const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
        console.error('No token provided in request headers');
        return res.status(401).json({ error: 'Authentication required. No token provided.' });
    }
    try {
        const decodedToken = await auth.verifyIdToken(token);
        req.user = decodedToken;
        console.log('Token verified for user:', decodedToken.uid);
        next();
    } catch (error) {
        console.error('Token verification failed:', error.message);
        res.status(403).json({ error: 'Invalid or expired token.', details: error.message });
    }
};

// --- TEST ROUTE (For Debugging Authentication) ---
app.get('/test-auth', verifyToken, (req, res) => {
    res.status(200).json({ message: 'Token verified successfully', user: req.user });
});

// --- API ROUTES ---

// Get all chat history for a logged-in user
app.get('/history', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const snapshot = await db.collection('users').doc(userId).collection('chats')
            .orderBy('createdAt', 'desc').get();
        const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`Fetched ${history.length} chats for user ${userId}`);
        res.status(200).json(history);
    } catch (error) {
        console.error('Failed to fetch chat history:', error.message);
        res.status(500).json({ error: 'Failed to fetch chat history.', details: error.message });
    }
});

// Get messages for a specific chat
app.get('/chat/:chatId', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const chatId = req.params.chatId;
        const snapshot = await db.collection('users').doc(userId).collection('chats')
            .doc(chatId).collection('messages').orderBy('createdAt').get();
        const messages = snapshot.docs.map(doc => doc.data());
        console.log(`Fetched ${messages.length} messages for chat ${chatId}`);
        res.status(200).json(messages);
    } catch (error) {
        console.error('Failed to fetch messages:', error.message);
        res.status(500).json({ error: 'Failed to fetch messages.', details: error.message });
    }
});

// Handle new content generation request
app.post('/generate', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { topic, platform, tone } = req.body;

        // Validate input
        if (!topic || !platform || !tone) {
            console.error('Missing required fields:', { topic, platform, tone });
            return res.status(400).json({ error: 'All fields (topic, platform, tone) are required.' });
        }

        // Create new chat document
        const chatRef = await db.collection('users').doc(userId).collection('chats').add({
            title: topic.substring(0, 25) + '...',
            createdAt: new Date().toISOString()
        });
        const currentChatId = chatRef.id;

        // Store user request
        const userRequest = `**Topic:** ${topic}\n**Platform:** ${platform}\n**Tone:** ${tone}`;
        await db.collection('users').doc(userId).collection('chats').doc(currentChatId)
            .collection('messages').add({
                role: 'user',
                text: userRequest,
                createdAt: new Date().toISOString()
            });

        // Generate content
        const specializedPrompt = `You are an expert social media manager. Generate a post based on this request:\n- Topic: "${topic}"\n- Platform: "${platform}"\n- Tone: "${tone}"`;
        const result = await model.generateContent(specializedPrompt);
        const modelResponse = result.response.text();

        // Store model response
        await db.collection('users').doc(userId).collection('chats').doc(currentChatId)
            .collection('messages').add({
                role: 'model',
                text: modelResponse,
                createdAt: new Date().toISOString()
            });

        console.log(`Generated content for user ${userId}, chat ${currentChatId}`);
        res.status(200).json({
            chatId: currentChatId,
            userRequest,
            response: modelResponse
        });
    } catch (error) {
        console.error('Content generation failed:', error.message);
        res.status(500).json({ error: 'Failed to generate content.', details: error.message });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});