// Zoek de knoppen en tekstvelden in de HTML op via hun id
const btnMakeRoute = document.getElementById('btn-make-route');
const btnStart = document.getElementById('btn-start');
const btnFinish = document.getElementById('btn-finish');
const btnNew = document.getElementById('btn-new');
const messageEl = document.getElementById('message');
const walkResultEl = document.getElementById('walk-result');

// Bewaart de route die de server terugstuurt (GeoJSON)
let routeData = null;

// --- Variabelen voor de kaart ---
// map = het Leaflet-kaartobject (de hele interactieve kaart)
// routeLayer = de groene lijn die de wandelroute tekent
// Beide starten als null omdat er nog geen kaart is bij het laden van de pagina
let map = null;
let routeLayer = null;
// Kleur van de routelijn (zelfde groen als de accentkleur in style.css)
const ROUTE_COLOR = '#2d6a4f';

// --- Variabelen voor wandelen ---
let watchId = null;        // ID van de lopende GPS-tracking (nodig om te stoppen)
let userMarker = null;     // blauw puntje op de kaart
let walkStartTime = null;  // tijdstip waarop op Start is geklikt
const USER_MARKER_COLOR = '#3388ff';

// Toon een melding aan de gebruiker in het groene/rode vak (#message)
function showMessage(text, isSuccess = false) {
  messageEl.textContent = text;
  messageEl.classList.remove('hidden', 'success');
  // isSuccess = true geeft een groene infomelding (bijv. "Route wordt gemaakt...")
  if (isSuccess) {
    messageEl.classList.add('success');
  }
}

// Verberg het meldingsvak
function hideMessage() {
  messageEl.classList.add('hidden');
  messageEl.classList.remove('success');
}

// Verberg het wandelresultaat (gewandelde minuten)
function hideWalkResult() {
  walkResultEl.classList.add('hidden');
  walkResultEl.textContent = '';
}

// Kijk welke duur-radioknop is aangevinkt (30, 60, 120 of 240)
function getSelectedMinutes() {
  const selected = document.querySelector('input[name="minutes"]:checked');
  // Geen keuze? Geef null terug zodat er een foutmelding getoond kan worden
  if (!selected) {
    return null;
  }
  return Number(selected.value);
}

// Zet knoppen goed nadat de route succesvol is opgehaald
function setButtonsAfterRoute() {
  btnMakeRoute.disabled = true;  // route is al gemaakt
  btnStart.disabled = false;     // gebruiker mag nu gaan wandelen
  btnFinish.disabled = true;   // nog niet aan het wandelen
  btnNew.disabled = false;      // als je een nieuwe route wilt maken
}

// Zet knoppen terug naar de beginsituatie
function setButtonsInitial() {
  btnMakeRoute.disabled = false;
  btnStart.disabled = true;
  btnFinish.disabled = true;
  btnNew.disabled = true;
}

// Tijdens het wandelen: alleen Klaar is actief
function setButtonsDuringWalk() {
  btnMakeRoute.disabled = true;
  btnStart.disabled = true;
  btnFinish.disabled = false;
  btnNew.disabled = true;
}

// Na Klaar: alleen Nieuw is actief
function setButtonsAfterFinish() {
  btnMakeRoute.disabled = true;
  btnStart.disabled = true;
  btnFinish.disabled = true;
  btnNew.disabled = false;
}

// --- GPS ophalen ---
// De browser (niet onze server!) heeft toegang tot GPS via je telefoon of laptop.
// getCurrentPosition() vraagt die locatie op en geeft die terug als lat + lng.
function getCurrentPosition() {
  // Een Promise is een "belofte": straks komt er een resultaat (of een fout).
  // resolve = het is gelukt, hier is je data
  // reject  = het is mislukt, hier is de fout
  return new Promise((resolve, reject) => {
    // navigator.geolocation is een ingebouwde browser-functie voor GPS
    if (!navigator.geolocation) {
      reject(new Error('GPS wordt niet ondersteund door je browser.'));
      return;
    }

    // De browser vraagt nu toestemming: "Deze site wil je locatie weten"
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => reject(new Error('Kon je locatie niet ophalen. Sta GPS toe in je browser.')),
      {
        enableHighAccuracy: true, // zo nauwkeurig mogelijk (handig voor wandelen)
        timeout: 10000,           // geef op na 10 seconden als GPS te lang duurt
      }
    );
  });
}

// --- Route ophalen bij onze server ---
// Stuurt lat, lng en minutes naar POST /api/route (onze eigen API in server.js).
// De server belt OpenRouteService en stuurt de route terug als GeoJSON.
async function fetchRoute(lat, lng, minutes) {
  // fetch = verzoek sturen naar een URL (hier: onze eigen server op hetzelfde adres)
  const response = await fetch('/api/route', {
    method: 'POST', // Stuurt data mee (geen gewone pagina-opvraag)
    headers: { 'Content-Type': 'application/json' }, // Stuurt JSON
    body: JSON.stringify({ lat, lng, minutes }),     // zet object om naar JSON-tekst
  });

  // response.json() zet het antwoord van de server om van JSON naar een JavaScript-object
  const data = await response.json();

  // response.ok is true bij succes (status 200), false bij fout (400, 500, etc.)
  if (!response.ok) {
    // throw stopt de functie en geeft de fout door aan handleMakeRoute (catch-blok)
    throw new Error(data.error || 'Kon geen route ophalen.');
  }

  return data; // de route (GeoJSON) — wordt opgeslagen in routeData
}

// --- Kaart (Leaflet) ---

// Start de kaart en zet hem op de locatie van de gebruiker
function initMap(lat, lng) {
  // Bestaat de kaart al? Alleen centreren, niet opnieuw aanmaken
  if (map) {
    map.setView([lat, lng], 15); // [lat, lng] = Leaflet-volgorde, 15 = zoomniveau
    return;
  }

  // L.map('map') koppelt Leaflet aan de div met id="map" in index.html
  // setView = waar de kaart op centreert en hoe ver ingezoomd (15 = wijk-niveau)
  map = L.map('map').setView([lat, lng], 15);

  // tileLayer = de achtergrondplaatjes van de kaart (straten, water, gebouwen)
  // OpenStreetMap levert die gratis aan; Leaflet laadt ze automatisch per stukje
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', // verplichte bronvermelding
  }).addTo(map); // plak de achtergrond op de kaart
}

// Haal de oude routelijn weg voordat een nieuwe getekend wordt
function clearRouteLayer() {
  if (routeLayer && map) {
    map.removeLayer(routeLayer); // verwijder de lijn van de kaart
    routeLayer = null;           // reset zodat er geen lijn meer is
  }
}

// L.geoJSON leest het GeoJSON-formaat van OpenRouteService en maakt er een lijn van
function drawRoute(geoJson, userLat, userLng) {
  routeLayer = L.geoJSON(geoJson, {
    style: {
      color: ROUTE_COLOR, // groene lijn
      weight: 5,          // dikte van de lijn in pixels
    },
  }).addTo(map); // plak de routelijn op de kaart

  // Groen puntje = hier begin je (jouw GPS-locatie bij Maak route)
  L.circleMarker([userLat, userLng], {
    radius: 7,
    fillColor: ROUTE_COLOR, // groene vulkleur
    color: '#ffffff', // witte rand om het puntje
    weight: 2, // dikte van die rand
    fillOpacity: 1, // volledig zichtbaar (niet doorzichtig)
  }).addTo(routeLayer);

  return routeLayer; // return de lijn
}

// Hoofdfunctie: zet de route uit de server (GeoJSON) als groene lijn op de kaart
function showRouteOnMap(geoJson, lat, lng) {
  initMap(lat, lng);    // stap 1: zorg dat de kaart bestaat en op de juiste plek staat
  clearRouteLayer();    // stap 2: verwijder eventuele oude lijn
  drawRoute(geoJson, lat, lng);

  // fitBounds zoomt de kaart automatisch zodat de hele route in beeld past
  // padding = een beetje ruimte rondom de route zodat de lijn niet tegen de rand plakt
  map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
}

// --- Wandelen ---

// Stop de GPS-tracking die bij Start is begonnen
function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// Verwijder het blauwe puntje van de kaart
function clearUserMarker() {
  if (userMarker && map) {
    map.removeLayer(userMarker);
    userMarker = null;
  }
}

// Tekent of verplaatst het blauwe puntje op de kaart
// Wordt steeds opnieuw aangeroepen zolang GPS-tracking loopt (bij Start)
function updateUserPosition(lat, lng) {
  // Geen kaart? Dan kunnen we niets tekenen
  if (!map) {
    return;
  }

  // Bestaat het puntje al? Alleen verplaatsen naar de nieuwe GPS-positie
  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
    return;
  }

  // Eerste keer: maak een blauw cirkeltje op de kaart
  userMarker = L.circleMarker([lat, lng], {
    radius: 8,                      // grootte van het puntje
    fillColor: USER_MARKER_COLOR,   // blauwe vulkleur
    color: '#ffffff',               // witte rand om het puntje
    weight: 2,                      // dikte van die rand
    fillOpacity: 1,                 // volledig zichtbaar (niet doorzichtig)
  }).addTo(map);
}

// --- Klik op "Start" ---
function handleStart() {
  hideMessage();
  hideWalkResult();

  // Controleer of GPS wordt ondersteund door de browser anders fout melding tonen
  if (!navigator.geolocation) {
    showMessage('GPS wordt niet ondersteund door je browser.');
    return;
  }

  // Onthoud het moment waarop de wandeling begint (in milliseconden sinds 1970)
  walkStartTime = Date.now();

  // watchPosition blijft je locatie opvragen (anders dan getCurrentPosition, dat is één keer)
  // Elke keer als de GPS een nieuwe positie heeft, verplaatst het blauwe puntje
  watchId = navigator.geolocation.watchPosition(
    (position) => {
      updateUserPosition(position.coords.latitude, position.coords.longitude);
    },
    () => {
      showMessage('GPS-signaal verloren. Controleer je locatie-instellingen.');
    },
    { enableHighAccuracy: true } // zo nauwkeurig mogelijk tijdens het wandelen
  );

  setButtonsDuringWalk(); // alleen "Klaar" is nu actief
}

// --- Klik op "Klaar" ---
function handleFinish() {
  stopWatching(); // stop met GPS volgen

  // Reken uit hoeveel minuten er zijn verstreken sinds Start
  // Date.now() - walkStartTime = milliseconden → delen door 60000 = minuten
  const walkedMinutes = walkStartTime
    ? Math.round((Date.now() - walkStartTime) / 60000)
    : 0;

  // Toon het resultaat in het groene vak onder de knoppen
  walkResultEl.textContent = `Je hebt ${walkedMinutes} minuten gewandeld.`;
  walkResultEl.classList.remove('hidden');

  walkStartTime = null;
  setButtonsAfterFinish(); // alleen "Nieuw" is nu actief
}

// --- Klik op "Nieuw" ---
// Zet alles terug zodat je opnieuw een wandeling kunt plannen
function handleNew() {
  stopWatching();     // stop eventuele lopende GPS-tracking
  clearUserMarker();  // verwijder blauw puntje
  clearRouteLayer();  // verwijder groene routelijn

  routeData = null;
  walkStartTime = null;

  hideMessage();
  hideWalkResult();

  // Maak de duur-keuze (30 min / 1 uur / etc.) weer leeg
  document.querySelectorAll('input[name="minutes"]').forEach((radio) => {
    radio.checked = false;
  });

  setButtonsInitial(); // terug naar beginsituatie: alleen "Maak route" actief
}

// --- Alles wat er gebeurt bij een klik op "Maak route" ---
// async = deze functie mag wachten op GPS en op het antwoord van de server
async function handleMakeRoute() {
  // Wis oude meldingen van een vorige poging
  hideMessage();
  hideWalkResult();

  // Stap 1: heeft de gebruiker een duur gekozen?
  const minutes = getSelectedMinutes();
  if (!minutes) {
    showMessage('Kies eerst hoelang je wilt wandelen.');
    return; // stop hier — verder gaan heeft geen zin
  }

  // Voorkom dubbel klikken terwijl die bezig is met een route maken
  btnMakeRoute.disabled = true;
  showMessage('Locatie ophalen...', true);

  // try/catch: probeer het, en vang fouten op (GPS of API kan misgaan)
  try {
    // Stap 2: wacht op GPS van de browser
    const position = await getCurrentPosition();
    const lat = position.coords.latitude;   // noord/zuid-positie op de aarde
    const lng = position.coords.longitude;  // oost/west-positie op de aarde

    // Stap 3: stuur locatie + duur naar onze server en wacht op de route
    showMessage('Route wordt gemaakt...', true);
    routeData = await fetchRoute(lat, lng, minutes);

    // Stap 4: teken de opgehaalde route op de Leaflet-kaart
    showRouteOnMap(routeData, lat, lng);

    // Stap 5: alles gelukt — verberg melding en zet knoppen goed (Start wordt actief)
    hideMessage();
    setButtonsAfterRoute();
  } catch (error) {
    // GPS geweigerd, timeout, of server gaf een fout — toon dat aan de gebruiker
    routeData = null;
    setButtonsInitial();
    showMessage(error.message);
  }
}

// Event listeners voor de knoppen
btnMakeRoute.addEventListener('click', handleMakeRoute);
btnStart.addEventListener('click', handleStart);
btnFinish.addEventListener('click', handleFinish);
btnNew.addEventListener('click', handleNew);

// Zorg dat knoppen bij het laden van de pagina in de juiste staat staan
setButtonsInitial();
