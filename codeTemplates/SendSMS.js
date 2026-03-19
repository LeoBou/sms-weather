require('dotenv').config();   
const myPhoneNumbers = process.env.MY_PHONES?.split(',') || [];   
const apiKeySecret = process.env.API_SECRET;
const apiKeySid = process.env.API_SID;
const authToken = process.env.ACCOUNT_SID;
const client = require('twilio')(apiKeySid, apiKeySecret, {
    accountSid: authToken
});
client.messages
    .create({
        body: 'blabla',  //TEXT À ENVOYER ICI
        from: process.env.NUM_TWILIO,   //NUMÉRO TWILIO forme +1 234 567 8910
        to: myPhoneNumbers[0]   //NUMÉRO CLIENT forme +1 234 567 8910
    })
    .then(message => console.log(message.sid));