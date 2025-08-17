// server.js (Final Version with Deployment Fix)

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// --- INITIALIZATION ---
const serviceAccount = JSON.parse(readFileSync('./serviceAccountKey.json'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
const auth = admin.auth();

const app = express();
app.use(cors()); // Use simple cors for deployment
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- THIS IS THE FIX ---
// Add a root route for Render's health check
app.get("/", (req, res) => {
    res.send("AI Content Studio Backend is alive!");
});

// --- AUTHENTICATION MIDDLEWARE ---
const verifyToken = async (req, res, next) => {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) { return res.status(401).send('Authentication required.'); }
    try {
        const decodedToken = await auth.verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        res.status(403).send('Invalid or expired token.');
    }
};

// --- API ROUTES ---
app.get('/history', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const snapshot = await db.collection('users').doc(userId).collection('chats').orderBy('createdAt', 'desc').get();
        const history = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
});

app.get('/chat/:chatId', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const chatId = req.params.chatId;
        const snapshot = await db.collection('users').doc(userId).collection('chats').doc(chatId).collection('messages').orderBy('createdAt').get();
        const messages = snapshot.docs.map(doc => doc.data());
        res.status(200).json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch messages.' });
    }
});

app.post('/generate', verifyToken, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { topic, platform, tone } = req.body;
        if (!topic || !platform || !tone) {
            return res.status(400).json({ error: 'All fields are required.' });
        }
        const chatRef = await db.collection('users').doc(userId).collection('chats').add({
            title: topic.substring(0, 25) + '...',
            createdAt: new Date().toISOString()
        });
        const currentChatId = chatRef.id;
        const userRequest = `**Topic:** ${topic}\n**Platform:** ${platform}\n**Tone:** ${tone}`;
        await db.collection('users').doc(userId).collection('chats').doc(currentChatId).collection('messages').add({
            role: 'user', text: userRequest, createdAt: new Date().toISOString()
        });
        const specializedPrompt = `You are an expert social media manager. Generate a post based on this request:\n- Topic: "${topic}"\n- Platform: "${platform}"\n- Tone: "${tone}"`;
        const result = await model.generateContent(specializedPrompt);
        const modelResponse = result.response.text();
        await db.collection('users').doc(userId).collection('chats').doc(currentChatId).collection('messages').add({
            role: 'model', text: modelResponse, createdAt: new Date().toISOString()
        });
        res.status(200).json({
            chatId: currentChatId,
            userRequest: userRequest,
            response: modelResponse
        });
    } catch (error) {
        res.status(500).json({ error: 'An error occurred.' });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is live and running on port ${PORT}`);
});