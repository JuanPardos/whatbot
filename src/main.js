const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const readline = require('readline-sync');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// ===== Env and config =====

require('dotenv').config()
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY
});
const blacklistGroups = process.env.BLACKLIST ? process.env.BLACKLIST.split(',') : [];
const googleSearchApi = process.env.GOOGLE_SEARCH_API;
const privateNumber2 = process.env.PRIVATE_NUMBER2;
const privateNumber = process.env.PRIVATE_NUMBER;
const localBaseUrl = process.env.LOCAL_ENDPOINT;
const defaultMode = process.env.DEFAULT_MODE;
const debug = process.env.DEBUG === 'true';
const googleCx = process.env.GOOGLE_CX;
const group1 = process.env.GROUP1;

const systemInstructions = "Responde en español";
const systemInstructionsReplyAI = "Responde al primer mensaje como si estuvieses en un conversación privada con una persona, debe ser natural y directa. Te adjunto los últimos 10 mensajes como contexto de la conversación, da prioridad al primero, es el más reciente. No debes dar información, mencionar o referenciar los mensajes anteriores, responde de forma breve."

let operationMode = null;
let modelName = null;


// ===== BOT INIT =====

// Create a new client instance. With cache session management. Uncomment no-gui lines if needed
const client = new Client({
    // no-gui
    /*puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: '/usr/bin/chromium',
    },*/
    authStrategy: new LocalAuth()
});

// When the client is ready, run this code (only once)
client.once('ready', async () => {
    console.log('Client is ready!');
    // await listGroups();
});

// When the client received QR-Code
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

// Start whatsapp client
client.initialize();


// ===== CORE =====

// List local models
async function fetchLocalModels() {
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
    } catch (err) {
        console.error('Error fetching local models, backend is online ¿?: ', err.message);
        process.exit(1);
    }
}

// Select operation mode and llm
async function selectModel() {
    if (defaultMode) {
        if (defaultMode === 'openai') {
            operationMode = 'openai';
        } else if (defaultMode === 'local') {
            operationMode = 'local';
            await fetchLocalModels();
        } else {
            console.error('DEFAULT_MODE not valid, must be "openai" or "local"');
            process.exit(1);
        }
        return;
    }

    while (!operationMode) {
        const opcion = readline.question('¿Which mode do you want to use? (1: OpenAI, 2: Local): ');
        if (opcion === '1') {
            operationMode = 'openai';
        } else if (opcion === '2') {
            operationMode = 'local';
            await fetchLocalModels();
        }
    }
}

// OpenAi request
async function askOpenAi(prompt) {
    const response = await openai.responses.create({
        model: "gpt-5-mini-2025-08-07",
        max_output_tokens: 2048,
        reasoning: { effort: "low" },
        text: { verbosity: "low" },
        stream: false,
        input: prompt
    });
    return "🤖:  " + response.output_text;
}

// Local model request
async function askLocal(prompt) {
    try {
        const response = await axios.post(localBaseUrl + '/v1/chat/completions', {
            model: modelName,
            messages: [
                { role: "system", content: systemInstructions },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 2048,
            stream: false
        });
        return "🤖:  " + response.data.choices[0].message.content;
    } catch (error) {
        return "Error local: " + error.message;
    }
}

// Reply mode OpenAi.
async function replyOpenAi(context) {
    conversation = '';
    try {
        for (const msg of context) {
            conversation += `${msg.user}: ${msg.message}\n`;
        }
        const response = await openai.responses.create({
            model: "gpt-5-mini-2025-08-07",
            instructions: systemInstructionsReplyAI,
            stream: false,
            max_output_tokens: 512,
            input: conversation,
            reasoning: { effort: "low" }
        });

        const text = response.output_text;
        return "🤖:  " + text.trim();
    } catch (err) {
        return 'Error generating response: ' + err.message;
    }
}

// Handle model prompt
async function modelPrompt(message) {
    const prompt = message.body.slice(4).trim();
    let response;
    if (operationMode === 'openai') {
        response = await askOpenAi(prompt);
    } else {
        response = await askLocal(prompt);
    }
    message.reply(response);
}

// Check if group is blacklisted. Id must be serialized
function groupIsBlacklisted(chatId) {
    return blacklistGroups.includes(chatId);
}

// ===== UTILS =====

// Schedule a message
function scheduleMessage(hour, minute, chatId) {
    const now = new Date();
    const target = new Date();
    target.setHours(hour, minute, 0, 0);
    const imgPath = path.join(__dirname, 'media', '1.jpg');

    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }

    const msUntilSend = target - now;
    console.log(`Message scheduled for ${target.toLocaleTimeString()}`);

    const timer = setTimeout(async () => {
        await client.sendMessage(chatId, MessageMedia.fromFilePath(imgPath));
    }, msUntilSend);

    timer.unref();
}
scheduleMessage(0, 27, group1);

// Retrieve and send 4 random images from Google Custom Search 
async function googleImageSearch(query, chatId) {
    const url = `https://customsearch.googleapis.com/customsearch/v1?cx=${googleCx}&num=10&q=${encodeURIComponent(query)}&searchType=image&key=${googleSearchApi}`;
    try {
        const res = await axios.get(url);
        let items = res.data.items || [];
        if (items.length === 0) {
            await client.sendMessage(chatId, 'No se encontraron imágenes.');
            return;
        }
        items = items.sort(() => 0.5 - Math.random()).slice(0, 4);

        let sent = 0;
        for (let i = 0; i < items.length; i++) {
            const imageUrl = items[i].link;
            let mimeType = items[i].mime || 'image/jpeg';
            let ext = 'jpg';
            if (mimeType === 'image/png') ext = 'png';
            else if (mimeType === 'image/webp') ext = 'webp';
            else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') ext = 'jpg';

            try {
                const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 7000 });
                const media = new MessageMedia(
                    mimeType,
                    Buffer.from(imgRes.data, 'binary').toString('base64'),
                    `image${i + 1}.${ext}`
                );
                await client.sendMessage(chatId, media);
                sent++;
            } catch (imgErr) {
                //console.log(`No se pudo descargar la imagen ${i + 1}: ${imageUrl} - ${imgErr.message}`);
            }
        }
        if (sent === 0) {
            await client.sendMessage(chatId, 'No se pudieron enviar imágenes. Intenta con otra búsqueda.');
        }
    } catch (error) {
        console.log('Error en la búsqueda de imágenes: ', error.message);
    }
}

// List groups
async function listGroups(){
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup);
    groups.forEach(group => {
        console.log(`Group Name: ${group.name}, ID: ${group.id._serialized}`);
    });
}

//TODO: GN scrapping

// ===== MAIN =====

(async () => {
    await selectModel();
})();

// Resets timer
if (!global.slowdownUntil) global.slowdownUntil = 0;

// Message creation event
client.on('message_create', async message => {
    const chat = await message.getChat();
    const chatId = chat.id._serialized;
    let isAdmin = message.fromMe;
    const now = Date.now();
    if (message.body === '!ping') {
        client.sendMessage(chatId, 'pong');
    } else if (message.body === '!slowdown') {
        if (isAdmin) {
            global.slowdownUntil = now + 10 * 60 * 1000;
            message.reply('ℹ️ Bloqueadas las peticiones de los demás usuarios durante 10 minutos.');
        } else if (now >= global.slowdownUntil) {
            message.reply('No tienes permiso para ejecutar este comando.');
        }
    } else if (message.body === '!reset') {
        if (isAdmin) {
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
            if (now - lastTime > 60000) {
                global.lastAiRequest[userId] = now;
                await modelPrompt(message);
            } else {
                message.reply('⏳ Espera 1 minuto antes de volver a preguntar. También puedes pagar en Ethereum para reducir el tiempo de espera.');
            }
        }
    } else if (message.body.startsWith('!image')) {
        if (isAdmin) {
            const query = message.body.slice(6).trim();
            if (!query) {
                message.reply('Debes escribir una búsqueda. Ejemplo: !image gatos');
                return;
            }
            await googleImageSearch(query, chatId);
        }
    } else {
        if (message.fromMe) return; // Dont' reply to myself, prevents infinite loop. Disable for private testing. Maybe is better to use message_received event instead.

        if (debug) {
            console.log('-------', message.body);
            console.log('message.getChat(): ', await message.getChat());
            console.log('message.from: ', message.from);
            console.log('message.getMentions(): ', await message.getMentions());
            console.log('message.mentionedIds: ', message.mentionedIds);
            console.log('message.to: ', message.to);
            console.log('message.getQuotedMessage(): ', await message.getQuotedMessage());
            console.log('message', message);
        }
        
        // Private chat testing
        if (message.from === privateNumber) {
            const chat = await message.getChat();
            const messages = await chat.fetchMessages({ limit: 10 });
            const context = [];
            for (let i = messages.length - 1; i >= 0; i--) {
                const contact = await messages[i].getContact();
                context.push({
                    user: contact.pushname,
                    message: messages[i].body
                });
            }
            const response = await replyOpenAi(context);
            message.reply(response);
        }

        //WARNING
        /* if (message.from === group1) {
            const chat = await message.getChat();
            const messages = await chat.fetchMessages({ limit: 10 });
            const context = [];
            for (let i = messages.length - 1; i >= 0; i--) {
                const contact = await messages[i].getContact();
                context.push({
                    user: contact.pushname,
                    message: messages[i].body
                });
            }

            // Mention @
            let mentions =  await message.getMentions();
            for (let i = 0; i < mentions.length; i++) {
                if (mentions[i].isMe) {
                    const response = await replyOpenAi(context);
                    message.reply(response);
                }
            }
            // Reply
            if (message.hasQuotedMsg) {
                let quotedMessage = await message.getQuotedMessage();
                if (quotedMessage.fromMe) {
                    const response = await replyOpenAi(context);
                    message.reply(response);
                }
            }
        } */

        // Reaction troll
        const author = await message.getContact();
        if (author.id._serialized === privateNumber2) {
            const randomNumber = Math.floor(Math.random() * 1000) + 1;
            if (randomNumber === 69) {
                message.react('🏳️‍🌈');
            }
        }

    }
});

// Message delete event. DON'T USE THIS ON UNAUTHORIZED GROUPS, you have been warned.
client.on('message_revoke_everyone', async (after, before) => {
    const chat = await before.getChat();
    const chatId = chat.id._serialized;
    const imgPath = path.join(__dirname, 'media', 'deleted.jpg');

    if (!groupIsBlacklisted(chatId) && !before.fromMe) {
        // Send "Jesus saw what you deleted" meme
        if (fs.existsSync(imgPath)) {
            if (!chat.isGroup) {
                await client.sendMessage(chatId, MessageMedia.fromFilePath(imgPath));
            } else {
                //TODO: Mention author in message or say "Author" deleted this media
                await client.sendMessage(chatId, MessageMedia.fromFilePath(imgPath));
            }
        } else {
            console.error('Media file not found:', imgPath);
        }
    }
    
    //Just in case before data isn't available
    if (!before) {
        const author = await after.getContact();
        const chat = await after.getChat();
        console.log(author.pushname + '[+' + author.number + ']@' + chat.name + ' deleted a message but no data is available.');
    } else {
        const author = await before.getContact();
        const chat = await before.getChat();
        if (!before.hasMedia) {
            console.log(author.pushname + '[+' + author.number + ']@' + chat.name + ' deleted the message: ' + before.body);
        }
    }

});
