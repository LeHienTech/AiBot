require('dotenv').config();
const axios = require('axios');
const { AI_CONFIG } = require('./src/config');

async function test() {
    try {
        console.log('Testing WITHOUT json_object...');
        const res1 = await axios.post(AI_CONFIG.URL, {
            model: AI_CONFIG.MODEL,
            messages: [{ role: 'user', content: 'hello' }]
        }, { headers: { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` } });
        console.log('Res 1:', res1.status);
    } catch(e) {
        console.log('Err 1:', e.response?.status, e.response?.data);
    }

    try {
        console.log('Testing WITH json_object...');
        const res2 = await axios.post(AI_CONFIG.URL, {
            model: AI_CONFIG.MODEL,
            messages: [{ role: 'user', content: 'hello' }],
            response_format: { type: 'json_object' }
        }, { headers: { 'Authorization': `Bearer ${AI_CONFIG.API_KEY}` } });
        console.log('Res 2:', res2.status);
    } catch(e) {
        console.log('Err 2:', e.response?.status, e.response?.data);
    }
}
test();
