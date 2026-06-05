// Laadt geheime instellingen uit het .env bestand (zoals de API-key)
require('dotenv').config();

// Express = webserver, path = hulp bij bestandspaden
const express = require('express');
const path = require('path');

// Maak een nieuwe Express-app aan
const app = express();
// Poort waarop de server luistert (uit .env, of anders 3000)
const PORT = process.env.PORT || 3000;

// Alles in de map "public" wordt automatisch naar de browser gestuurd
app.use(express.static(path.join(__dirname, 'public')));

// Start de server en wacht op verzoeken van de browser
app.listen(PORT, () => {
  console.log(`Server draait op http://localhost:${PORT}`);
});
