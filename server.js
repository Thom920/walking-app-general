// Laadt geheime instellingen uit het .env bestand (zoals de API-key)
require('dotenv').config();

// Express = webserver, path = hulp bij bestandspaden
const express = require('express');
const path = require('path');

// Maak een nieuwe Express-app aan
const app = express();
// Poort waarop de server luistert
const PORT = 3000;

// Toegestane wandeltijden in minuten
const ALLOWED_MINUTES = [30, 60, 120, 240];

// Zet minuten om naar geschatte afstand in meters (uitgaande van 5 km/u wandeltempo)
function minutesToMeters(minutes) {
  return Math.round((minutes / 60) * 5000);
}

// Zet JSON om naar een JavaScript-object.
// De browser stuurt straks data als JSON, bijv. {"lat": 52.09, "lng": 5.12, "minutes": 30}
// Zonder deze regel is req.body leeg en werkt de API niet.
app.use(express.json());

// Dit endpoint heet POST /api/route.
// POST = de browser stuurt data mee (in tegenstelling tot GET, dat alleen ophaalt).
// async = deze functie wacht op antwoord van OpenRouteService (dat duurt even).
app.post('/api/route', async (req, res) => {
  // Haal de API-key op uit .env — alleen de server ziet deze, nooit de browser.
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;

  // Geen key? Dan kan er geen route worden opgehaald. Stop meteen met een foutmelding.
  if (!apiKey) {
    return res.status(500).json({ error: 'API-key ontbreekt op de server.' });
  }

  // req.body = de data die de browser meestuurde in het POST-verzoek.
  // lat = breedtegraad (noord/zuid), lng = lengtegraad (oost/west), minutes = wandeltijd.
  const { lat, lng, minutes } = req.body;

  // --- Validatie: controleer of de browser geldige data stuurt ---
  // Zo voorkom je dat iemand rare waarden instuurt of de API misbruikt.

  // Latitude moet een getal zijn tussen -90 en 90 (dat zijn alle geldige breedtegraden op aarde).
  if (typeof lat !== 'number' || lat < -90 || lat > 90) {
    return res.status(400).json({ error: 'Ongeldige latitude (lat).' });
  }

  // Longitude moet een getal zijn tussen -180 en 180.
  if (typeof lng !== 'number' || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Ongeldige longitude (lng).' });
  }

  // Alleen deze 4 wandeltijden zijn toegestaan (wat de gebruiker in de app kan kiezen).
  if (!ALLOWED_MINUTES.includes(minutes)) {
    return res.status(400).json({ error: 'Ongeldige duur. Kies 30, 60, 120 of 240 minuten.' });
  }

  // OpenRouteService wil afstand in meters, niet in minuten — dus eerst omrekenen.
  const lengthMeters = minutesToMeters(minutes);

  // try/catch: als het internet of OpenRouteService faalt, wordt de fout opgevangen.
  try {
    // fetch = een verzoek sturen naar een andere server (hier: OpenRouteService).
    const response = await fetch(
      'https://api.openrouteservice.org/v2/directions/foot-walking/geojson',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', // stuur json naar OpenRouteService
          Authorization: apiKey,               // onze geheime key als bewijs dat we mogen bellen
        },
        // body = de data die wordt meegestuurd in het POST-verzoek (het "pakketje" naar OpenRouteService).
        // JSON.stringify zet een JavaScript-object om naar JSON-tekst, bijv. {"coordinates":[[5.12,52.09]],...}
        // Dat moet, want over het internet wordt data als tekst verstuurd, niet als JavaScript-object.
        body: JSON.stringify({
          // OpenRouteService wil coördinaten als [lng, lat] — let op: andere volgorde dan gebruikelijk!
          coordinates: [[lng, lat]],
          options: {
            round_trip: {
              length: lengthMeters, // hoe lang het rondje ongeveer moet zijn
              points: 3,            // aantal tussenpunten (meer = ronder rondje)
            },
          },
        }),
      }
    );

    // Zet het antwoord van OpenRouteService om van JSON-tekst naar een JavaScript-object.
    const data = await response.json();

    // response.ok is false bij fouten (bijv. ongeldige key = status 403).
    if (!response.ok) {
      // Haal de fouttekst uit het antwoord (kan een string of een object zijn).
      const message =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || 'Kon geen route ophalen.';
      return res.status(response.status).json({ error: message });
    }

    // Alles goed: stuur de route (GeoJSON) terug naar de browser.
    res.json(data);
  } catch {
    // Netwerkprobleem of server van OpenRouteService onbereikbaar.
    res.status(500).json({ error: 'Verbinding met route-service mislukt.' });
  }
});

// Alles in de map "public" wordt automatisch naar de browser gestuurd
app.use(express.static(path.join(__dirname, 'public')));

// Start de server en wacht op verzoeken van de browser
app.listen(PORT, () => {
  console.log(`Server draait op http://localhost:${PORT}`);
});
