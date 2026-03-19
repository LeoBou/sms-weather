# Setup Twilio

## Installer et setup Twilio
`npm install twilio`
`npm install dotenv`
`npm install express`

Le conf doit être semblable à celui de démo pour que le mot de passe fonctionne et soit util

```
sudo a2enmod proxy
sudo a2enmod proxy_http
sudo a2enmod rewrite
sudo systemctl restart apache2

sudo htpasswd -c /etc/apache2/sms/.htpasswd twilio
```



## Webhook 
1. Aller dans active number et sélectionner le numéro
2. Créer un compte twilio sur votre serveur
```
sudo useradd twilio 
sudo passwd twilio
```
3. Ajouter votre adress de webhook de cette facon -> https://twilio:password@sms.test.com/

## Lancer le serv
`node app.js`