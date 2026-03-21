require("dotenv").config({
    path: "/var/www/configTwilio/.env",
});
const express = require("express");
const bodyParser = require("body-parser");
const { LogInstance } = require("twilio/lib/rest/serverless/v1/service/environment/log");
const { MessagingResponse } = require("twilio").twiml;

const app = express();
const openWttrApi = process.env.API;

app.use(bodyParser.urlencoded({ extended: false }));

async function getWeather(lat, lon) {
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${openWttrApi}&units=metric&exclude=minutely,alerts`;

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`HTTP error: ${res.status}`);
    }

    const data = await res.json();
    return data;
}

async function getWeatherJson(lat, lon) {
    const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${openWttrApi}&units=metric&exclude=minutely,alerts`;

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`HTTP error: ${res.status}`);
    }
    const data = await res.json();
    return data;
}

function compressWeather(json) {
    const buffer = new ArrayBuffer(117); // 117 bytes = 156 Base64 chars
    const view = new DataView(buffer);
    let p = 0;

    const t = (v) => Math.max(0, Math.min(255, Math.round((v || 0) + 40)));
    const w4 = (v) => Math.min(15, Math.round((v || 0) / 5));
    const pop4 = (v) => Math.min(15, Math.round((v || 0) * 15));

    const prec4 = (snow, rain) => {
        const getVal = (o) => o ? (typeof o === 'object' ? (o['1h'] || 0) : o) : 0;
        const amt = getVal(snow) > 0 ? getVal(snow) : getVal(rain);
        if (amt === 0) return 0;
        const levels = [0, 0.5, 1, 2, 5, 8, 12, 25];
        const idx = levels.reduce((prev, curr, i) =>
            Math.abs(curr - amt) < Math.abs(levels[prev] - amt) ? i : prev, 0);
        return snow ? (idx + 8) : idx;
    };

    // 1. CURRENT (11 bytes)
    const dt = new Date(json.current.dt * 1000);
    const hourlyStart = new Date(json.hourly[0].dt * 1000);

    view.setUint8(p++, dt.getDate()); // Day
    view.setUint8(p++, dt.getMonth() + 1); // Month
    view.setUint8(p++, hourlyStart.getHours()); // Starting Hour for Hourly
    view.setUint8(p++, t(json.current.temp));
    view.setUint8(p++, t(json.current.feels_like));

    const sr = new Date(json.current.sunrise * 1000);
    const ss = new Date(json.current.sunset * 1000);
    view.setUint8(p++, sr.getHours());
    view.setUint8(p++, sr.getMinutes());
    view.setUint8(p++, ss.getHours());
    view.setUint8(p++, ss.getMinutes());

    view.setUint8(p++, Math.min(255, Math.round(json.current.wind_speed)));
    view.setUint8(p++, Math.min(255, Math.round(json.current.wind_gust || 0)));

    // 2. HOURLY (16 samples = 32 hours) - 4 bytes each (64 bytes)
    for (let i = 0; i < 32; i += 2) {
        const h = json.hourly[i];
        view.setUint8(p++, t(h.temp));
        view.setUint8(p++, t(h.feels_like));
        view.setUint8(p++, (w4(h.wind_speed) << 4) | w4(h.wind_gust));
        view.setUint8(p++, (pop4(h.pop) << 4) | (prec4(h.snow, h.rain) & 0x0F));
    }

    // 3. DAILY (7 days) - 6 bytes each (42 bytes)
    for (let i = 0; i < 7; i++) {
        const d = json.daily[i];
        view.setUint8(p++, t(d.temp.morn));
        view.setUint8(p++, t(d.temp.day));
        view.setUint8(p++, t(d.temp.eve));
        view.setUint8(p++, t(d.temp.night));
        view.setUint8(p++, (w4(d.wind_speed) << 4) | pop4(d.pop));
        view.setUint8(p++, prec4(d.snow, d.rain));
    }

    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}


app.post("/", async(req, res) => {
    const twiml = new MessagingResponse();

    if (req.body.Body) var message = req.body.Body;
    else {
        twiml.message("Invalid Format");
    }
    const [lat, lon] = message.split(",").map((n) => Math.round(Number(n) * 100) / 100);

    if (/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(message)) {
        try {
            const data = await getWeatherJson(lat, lon);
            var compressedData = compressWeather(data)
        } catch (err) {
            console.error(err);
            twiml.message("Weather fetch failed");
            return res.type('text/xml').send(twiml.toString());
        }


        twiml.message("WX:" + compressedData);
        //twiml.message(openWttrApi);
    } else {
        twiml.message("Invalid Format");
    }
    res.type("text/xml").send(twiml.toString());
});

app.listen(3000, () => {
    console.log("Express server listening on port 3000");
});