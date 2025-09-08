const { Client, LocalAuth } = require('whatsapp-web.js');
const readline = require('readline-sync');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const axios = require('axios');
require('dotenv').config()

// Env and config
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY
});
const localBaseUrl = process.env.LOCAL_ENDPOINT;
const myNumber = process.env.MY_NUMBER;
const group1 = process.env.GROUP1;

const systemInstructions = "Responde en español";

let selectedModel = null;
let modelName = null;

let debug = false;

// Select operation mode and llm
async function selectModel() {
    while (!selectedModel) {
        const opcion = readline.question('¿Which mode do you want to use? (1: OpenAI, 2: Local): ');
        if (opcion === '1') {
            selectedModel = 'openai';
        } else if (opcion === '2') {
            selectedModel = 'local';
            try {
                const res = await axios.get(localBaseUrl + '/v1/models');
                let modelos = res.data.models || res.data;
                if (!Array.isArray(modelos)) {
                    if (typeof modelos === 'object' && modelos.data && Array.isArray(modelos.data)) {
                        modelos = modelos.data;
                    } else {
                        modelos = Object.values(modelos);
                    }
                }
                modelos.forEach((m, i) => {
                    console.log(`${i + 1}: ${m.id || m.name || m}`);
                });
                let idx = -1;
                while (idx < 0 || idx >= modelos.length) {
                    idx = parseInt(readline.question('Choose a model: '), 10) - 1;
                }
                modelName = modelos[idx].id || modelos[idx].name || modelos[idx];
                console.log('Selected model:', modelName);
            } catch (err) {
                console.error('Error fetching local models:', err.message);
                process.exit(1);
            }
        }
    }
}

(async () => {
    await selectModel();
})();

// Create a new client instance. With session management.
const client = new Client({
    //no-gui
    /*puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: '/usr/bin/chromium',
    },*/
    authStrategy: new LocalAuth()
});

// When the client is ready, run this code (only once)
client.once('ready', async () => {
    console.log('Client is ready!');
});

// When the client received QR-Code
client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
}); 

// Start whatsapp client
client.initialize();

// Official OpenAI API
async function askOpenAi(prompt) {
    const response = await openai.responses.create({
        model: "gpt-5-mini-2025-08-07",
        max_output_tokens: 4096,
        input: prompt
    });
    return "🤖:  " + response.output_text;
}

// Local OpenAI API compliant
async function askLocal(prompt) {
    try {
        const response = await axios.post(localBaseUrl + '/v1/chat/completions', {
            model: modelName,
            messages: [
                { role: "system", content: systemInstructions },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 4096,
            stream: false
        });
        return "🤖:  " + response.data.choices[0].message.content;
    } catch (error) {
        return "Error local: " + error.message;
    }
}

// Handle model prompt
async function modelPrompt(message){
    const prompt = message.body.slice(4).trim();
    let response;
    if (selectedModel === 'openai') {
        response = await askOpenAi(prompt);
    } else {
        response = await askLocal(prompt);
    }
    message.reply(response);
}

if (!global.slowdownUntil) global.slowdownUntil = 0;

// Receive message
client.on('message_create', async message => {
    let isAdmin = message.fromMe;
    const now = Date.now();
    if (message.body === '!ping') {
        client.sendMessage(message.from, 'pong');
    } else if (message.body === '!slowdown') {
        if (isAdmin) {
            global.slowdownUntil = now + 5 * 60 * 1000;
            message.reply('ℹ️ Bloqueadas las peticiones de los demás usuarios durante 5 minutos.');
        } else if (now >= global.slowdownUntil) {
            message.reply('No tienes permiso para ejecutar este comando.');
        }
    } else if (message.body === '!reset') {
        if(isAdmin){
            global.slowdownUntil = 0;
            message.reply('✅ El modo limitado ha sido desactivado.');
        } else if (now >= global.slowdownUntil) {
            message.reply('No tienes permiso para ejecutar este comando.');
        }
    } else if (message.body.startsWith('!ai')) {
        if (!isAdmin && now < global.slowdownUntil) {
            // Don't reply, at all...
            return;
        }
        // Rate limit for other users
        if (!global.lastAiRequest) global.lastAiRequest = {};
        const userId = message.from;
        const lastTime = global.lastAiRequest[userId] || 0;
        if (isAdmin) {
            await modelPrompt(message);
        } else {
            if (now - lastTime > 30000) {
                global.lastAiRequest[userId] = now;
                await modelPrompt(message);
            } else {
                message.reply('⏳ Espera 30 segundos antes de volver a preguntar. También puedes pagar en Ethereum para reducir el tiempo de espera.');
            }
        }
    } else {
        if (message.fromMe) return; // Dont' reply to myself, prevents infinite loop. Disable for private testing.

        if (debug) {
            console.log('-------', message.body);
            console.log('message.broadcast: ', message.broadcast);
            console.log('message.getChat(): ', await message.getChat());
            console.log('message.from: ', message.from);
            console.log('message.getMentions(): ', await message.getMentions());
            console.log('message.mentionedIds: ', message.mentionedIds);
            console.log('message.to: ', message.to);
            console.log('message.getQuotedMessage(): ', await message.getQuotedMessage());
            console.log('message', message);
        }

        if ((await message.getChat()).id.user == group1) { 
            let respuesta = '🤖: Estoy ocupado 😈';

            // Mention
            let mentions = message.getMentions();
            for (let i = 0; i < mentions.length; i++) {
                if (mentions[i].isMe) {
                    message.reply(respuesta);
                }
            }

            // Reply
            if (message.hasQuotedMsg) {
                let quotedMessage = await message.getQuotedMessage();
                if (quotedMessage.fromMe) {
                    message.reply(respuesta);
                }
            }
        }

        //PRUEBAS CHAT PRIVADO
        if ((await message.getChat()).id.user == myNumber) {
            if (message.hasQuotedMsg) {
                let quotedMessage = await message.getQuotedMessage();
                if (quotedMessage.fromMe) {
                    message.reply('🤖:  Estoy durmiendo zZZZZZzzZ');
                }
            }
        }

    }
}
)

