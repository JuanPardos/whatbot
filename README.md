# Requirements
- Node.js > 18
- WhatsApp account
- OpenAI API key (if using OpenAI)

# How to run
- Set your environment variables (.env) and configs

```bash
npm install .
```
```bash
npm run start
```

## TODO
- Refactor.
- Settings persistence.
- Reply with local models.
- QOL like list chats, contacts, media handling etc.

## Tips and info
- Use message.getChat() to retrieve groupIDs.
- Can be used on no-gui systems. Uncomment no-gui settings, launch the program once and scan the QR code in console mode (ssh works).
- Local models must be OpenAI compatible. I suggest using LM Studio.
- For more info about WhatsApp Web JS, check the [library repository](https://github.com/pedroslopez/whatsapp-web.js).