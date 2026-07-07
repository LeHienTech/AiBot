require('dotenv').config();
const axios = require('axios');
const { AI_CONFIG } = require('./src/config');

async function test(modelName) {
    try {
        console.log(`Testing model: ${modelName}`);
        const res = await axios.post(AI_CONFIG.URL, {
            model: modelName,
            messages: [{ role: 'user', content: 'hello' }]
        }, { headers: { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` } });
        console.log(`Success ${modelName}:`, res.status);
    } catch(e) {
        console.log(`Err ${modelName}:`, e.response?.status, e.response?.data);
    }
}
test('gemma-2-27b-it');
test('gemini-1.5-flash');
