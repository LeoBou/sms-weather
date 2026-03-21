/**
 * WEATHER SMS SYSTEM - SINGLE 160-CHAR MESSAGE
 * Features: Actual Clock Hours, Numeric Dates, -40 to +40C
 * Coverage: 32h Hourly (2h steps) | 7 Days Daily
 */

// --- SENDER SIDE (SERVER) ---
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

// --- RECEIVER SIDE (APP) ---
function decompressWeather(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    let p = 0;

    const ut = (v) => v - 40;
    const uw = (v) => v * 5;
    const upop = (v) => Math.round((v / 15) * 100);
    const uprec = (v) => {
        if (v === 0) return "None";
        const amts = [0, 0.5, 1, 2, 5, 8, 12, 25];
        return `${amts[v % 8]}mm ${v >= 8 ? 'Snow' : 'Rain'}`;
    };

    const data = { current: {}, hourly: [], daily: [] };

    // 1. CURRENT
    const day = view.getUint8(p++);
    const month = view.getUint8(p++);
    const startHour = view.getUint8(p++);

    data.current = {
        date: `${day}/${month}`,
        temp: ut(view.getUint8(p++)),
        feels: ut(view.getUint8(p++)),
        sunrise: `${view.getUint8(p++)}:${view.getUint8(p++).toString().padStart(2,'0')}`,
        sunset: `${view.getUint8(p++)}:${view.getUint8(p++).toString().padStart(2,'0')}`,
        wind: view.getUint8(p++),
        gust: view.getUint8(p++)
    };

    // 2. HOURLY
    for (let i = 0; i < 16; i++) {
        const tv = ut(view.getUint8(p++)),
            fv = ut(view.getUint8(p++));
        const bW = view.getUint8(p++),
            bP = view.getUint8(p++);

        // Calculate the actual clock hour
        const currentHour = (startHour + (i * 2)) % 24;

        data.hourly.push({
            time: `${currentHour}:00`,
            temp: tv,
            feels: fv,
            wind: uw(bW >> 4),
            gust: uw(bW & 0x0F),
            pop: upop(bP >> 4),
            precip: uprec(bP & 0x0F)
        });
    }

    // 3. DAILY
    let dateTracker = new Date();
    dateTracker.setMonth(month - 1);
    dateTracker.setDate(day);

    for (let i = 0; i < 7; i++) {
        const temps = { morn: ut(view.getUint8(p++)), day: ut(view.getUint8(p++)), eve: ut(view.getUint8(p++)), night: ut(view.getUint8(p++)) };
        const bMisc = view.getUint8(p++),
            bPrec = view.getUint8(p++);

        data.daily.push({
            date: `${dateTracker.getDate()}/${dateTracker.getMonth() + 1}`,
            ...temps,
            wind: uw(bMisc >> 4),
            pop: upop(bMisc & 0x0F),
            precip: uprec(bPrec)
        });
        dateTracker.setDate(dateTracker.getDate() + 1);
    }

    return data;
}
// TEST EXAMPLE:
// console.log(JSON.stringify(decompressWeather(compressedString), null, 2));
const data = compressWeather({
    "lat": 48.43,
    "lon": -67.34,
    "timezone": "America/Toronto",
    "timezone_offset": -14400,
    "current": {
        "dt": 1774127381,
        "sunrise": 1774089015,
        "sunset": 1774132966,
        "temp": -4.08,
        "feels_like": -9.52,
        "pressure": 1011,
        "humidity": 72,
        "dew_point": -7.89,
        "uvi": 0.35,
        "clouds": 99,
        "visibility": 10000,
        "wind_speed": 4.29,
        "wind_deg": 314,
        "wind_gust": 7.25,
        "weather": [{
            "id": 804,
            "main": "Clouds",
            "description": "overcast clouds",
            "icon": "04d"
        }]
    },
    "hourly": [{
            "dt": 1774126800,
            "temp": -4.08,
            "feels_like": -9.52,
            "pressure": 1011,
            "humidity": 72,
            "dew_point": -7.89,
            "uvi": 0.35,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 4.29,
            "wind_deg": 314,
            "wind_gust": 7.25,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774130400,
            "temp": -4.31,
            "feels_like": -9.56,
            "pressure": 1011,
            "humidity": 73,
            "dew_point": -7.96,
            "uvi": 0,
            "clouds": 95,
            "visibility": 10000,
            "wind_speed": 3.98,
            "wind_deg": 311,
            "wind_gust": 8.41,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774134000,
            "temp": -5.57,
            "feels_like": -10.04,
            "pressure": 1011,
            "humidity": 78,
            "dew_point": -8.43,
            "uvi": 0,
            "clouds": 85,
            "visibility": 10000,
            "wind_speed": 2.86,
            "wind_deg": 300,
            "wind_gust": 7.23,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774137600,
            "temp": -7.8,
            "feels_like": -11.77,
            "pressure": 1012,
            "humidity": 86,
            "dew_point": -9.52,
            "uvi": 0,
            "clouds": 72,
            "visibility": 10000,
            "wind_speed": 2.15,
            "wind_deg": 281,
            "wind_gust": 3.85,
            "weather": [{
                "id": 803,
                "main": "Clouds",
                "description": "broken clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774141200,
            "temp": -10.37,
            "feels_like": -13.93,
            "pressure": 1013,
            "humidity": 95,
            "dew_point": -10.94,
            "uvi": 0,
            "clouds": 38,
            "visibility": 10000,
            "wind_speed": 1.67,
            "wind_deg": 262,
            "wind_gust": 0.82,
            "weather": [{
                "id": 802,
                "main": "Clouds",
                "description": "scattered clouds",
                "icon": "03n"
            }],
            "pop": 0
        },
        {
            "dt": 1774144800,
            "temp": -12.7,
            "feels_like": -12.7,
            "pressure": 1013,
            "humidity": 99,
            "dew_point": -13.3,
            "uvi": 0,
            "clouds": 42,
            "visibility": 9643,
            "wind_speed": 1.19,
            "wind_deg": 281,
            "wind_gust": 0.99,
            "weather": [{
                "id": 802,
                "main": "Clouds",
                "description": "scattered clouds",
                "icon": "03n"
            }],
            "pop": 0
        },
        {
            "dt": 1774148400,
            "temp": -12.55,
            "feels_like": -15.95,
            "pressure": 1013,
            "humidity": 96,
            "dew_point": -13.71,
            "uvi": 0,
            "clouds": 50,
            "visibility": 9621,
            "wind_speed": 1.45,
            "wind_deg": 283,
            "wind_gust": 2.52,
            "weather": [{
                "id": 802,
                "main": "Clouds",
                "description": "scattered clouds",
                "icon": "03n"
            }],
            "pop": 0
        },
        {
            "dt": 1774152000,
            "temp": -12.74,
            "feels_like": -16.44,
            "pressure": 1013,
            "humidity": 96,
            "dew_point": -13.85,
            "uvi": 0,
            "clouds": 52,
            "visibility": 8504,
            "wind_speed": 1.57,
            "wind_deg": 277,
            "wind_gust": 2.52,
            "weather": [{
                "id": 803,
                "main": "Clouds",
                "description": "broken clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774155600,
            "temp": -11.25,
            "feels_like": -15.73,
            "pressure": 1013,
            "humidity": 96,
            "dew_point": -12.24,
            "uvi": 0,
            "clouds": 56,
            "visibility": 10000,
            "wind_speed": 2.1,
            "wind_deg": 279,
            "wind_gust": 4.79,
            "weather": [{
                "id": 803,
                "main": "Clouds",
                "description": "broken clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774159200,
            "temp": -11.91,
            "feels_like": -15.76,
            "pressure": 1013,
            "humidity": 97,
            "dew_point": -12.71,
            "uvi": 0,
            "clouds": 64,
            "visibility": 10000,
            "wind_speed": 1.7,
            "wind_deg": 275,
            "wind_gust": 2.62,
            "weather": [{
                "id": 803,
                "main": "Clouds",
                "description": "broken clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774162800,
            "temp": -12.65,
            "feels_like": -17.04,
            "pressure": 1014,
            "humidity": 98,
            "dew_point": -13.62,
            "uvi": 0,
            "clouds": 95,
            "visibility": 10000,
            "wind_speed": 1.92,
            "wind_deg": 265,
            "wind_gust": 3.79,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774166400,
            "temp": -13.14,
            "feels_like": -17.4,
            "pressure": 1014,
            "humidity": 97,
            "dew_point": -14.26,
            "uvi": 0,
            "clouds": 89,
            "visibility": 10000,
            "wind_speed": 1.81,
            "wind_deg": 273,
            "wind_gust": 3.46,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774170000,
            "temp": -13.94,
            "feels_like": -17.7,
            "pressure": 1015,
            "humidity": 97,
            "dew_point": -15.04,
            "uvi": 0,
            "clouds": 81,
            "visibility": 10000,
            "wind_speed": 1.52,
            "wind_deg": 272,
            "wind_gust": 1.86,
            "weather": [{
                "id": 803,
                "main": "Clouds",
                "description": "broken clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774173600,
            "temp": -14.16,
            "feels_like": -14.16,
            "pressure": 1015,
            "humidity": 98,
            "dew_point": -15.24,
            "uvi": 0,
            "clouds": 81,
            "visibility": 6603,
            "wind_speed": 1.26,
            "wind_deg": 273,
            "wind_gust": 0.15,
            "weather": [{
                "id": 803,
                "main": "Clouds",
                "description": "broken clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774177200,
            "temp": -13.4,
            "feels_like": -16.77,
            "pressure": 1016,
            "humidity": 97,
            "dew_point": -14.54,
            "uvi": 0.09,
            "clouds": 85,
            "visibility": 5971,
            "wind_speed": 1.39,
            "wind_deg": 254,
            "wind_gust": 1.23,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774180800,
            "temp": -9.65,
            "feels_like": -13.18,
            "pressure": 1015,
            "humidity": 91,
            "dew_point": -11.17,
            "uvi": 0.44,
            "clouds": 85,
            "visibility": 10000,
            "wind_speed": 1.71,
            "wind_deg": 289,
            "wind_gust": 4.43,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774184400,
            "temp": -7.64,
            "feels_like": -12.14,
            "pressure": 1015,
            "humidity": 82,
            "dew_point": -10.29,
            "uvi": 1.03,
            "clouds": 85,
            "visibility": 10000,
            "wind_speed": 2.55,
            "wind_deg": 313,
            "wind_gust": 4.17,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774188000,
            "temp": -6.23,
            "feels_like": -10.29,
            "pressure": 1015,
            "humidity": 70,
            "dew_point": -10.72,
            "uvi": 1.8,
            "clouds": 87,
            "visibility": 10000,
            "wind_speed": 2.41,
            "wind_deg": 335,
            "wind_gust": 3.7,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774191600,
            "temp": -4.98,
            "feels_like": -8.59,
            "pressure": 1015,
            "humidity": 62,
            "dew_point": -11.04,
            "uvi": 2.53,
            "clouds": 90,
            "visibility": 10000,
            "wind_speed": 2.24,
            "wind_deg": 326,
            "wind_gust": 3.11,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774195200,
            "temp": -4.19,
            "feels_like": -7.65,
            "pressure": 1014,
            "humidity": 58,
            "dew_point": -11.02,
            "uvi": 3,
            "clouds": 92,
            "visibility": 10000,
            "wind_speed": 2.23,
            "wind_deg": 331,
            "wind_gust": 2.92,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774198800,
            "temp": -3.72,
            "feels_like": -7.26,
            "pressure": 1014,
            "humidity": 57,
            "dew_point": -10.68,
            "uvi": 2.96,
            "clouds": 94,
            "visibility": 10000,
            "wind_speed": 2.36,
            "wind_deg": 337,
            "wind_gust": 2.72,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774202400,
            "temp": -3.39,
            "feels_like": -7.08,
            "pressure": 1014,
            "humidity": 57,
            "dew_point": -10.54,
            "uvi": 2.68,
            "clouds": 96,
            "visibility": 10000,
            "wind_speed": 2.54,
            "wind_deg": 343,
            "wind_gust": 2.69,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774206000,
            "temp": -3.42,
            "feels_like": -6.85,
            "pressure": 1015,
            "humidity": 57,
            "dew_point": -10.66,
            "uvi": 1.81,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 2.31,
            "wind_deg": 346,
            "wind_gust": 1.99,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774209600,
            "temp": -3.75,
            "feels_like": -7.58,
            "pressure": 1015,
            "humidity": 58,
            "dew_point": -10.58,
            "uvi": 1.03,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 2.6,
            "wind_deg": 355,
            "wind_gust": 1.94,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774213200,
            "temp": -4.44,
            "feels_like": -8.79,
            "pressure": 1015,
            "humidity": 63,
            "dew_point": -10.34,
            "uvi": 0.4,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 2.96,
            "wind_deg": 4,
            "wind_gust": 2.66,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774216800,
            "temp": -6,
            "feels_like": -10.45,
            "pressure": 1016,
            "humidity": 71,
            "dew_point": -10.28,
            "uvi": 0.09,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 2.77,
            "wind_deg": 6,
            "wind_gust": 5.19,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774220400,
            "temp": -8.54,
            "feels_like": -11.53,
            "pressure": 1017,
            "humidity": 84,
            "dew_point": -10.81,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.52,
            "wind_deg": 2,
            "wind_gust": 2.11,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774224000,
            "temp": -9.53,
            "feels_like": -9.53,
            "pressure": 1018,
            "humidity": 89,
            "dew_point": -11.25,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.07,
            "wind_deg": 12,
            "wind_gust": 1.22,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774227600,
            "temp": -10.34,
            "feels_like": -10.34,
            "pressure": 1018,
            "humidity": 93,
            "dew_point": -11.65,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 0.87,
            "wind_deg": 34,
            "wind_gust": 0.29,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774231200,
            "temp": -10.57,
            "feels_like": -10.57,
            "pressure": 1018,
            "humidity": 94,
            "dew_point": -11.77,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 0.93,
            "wind_deg": 45,
            "wind_gust": 0.44,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774234800,
            "temp": -10.78,
            "feels_like": -10.78,
            "pressure": 1019,
            "humidity": 94,
            "dew_point": -12.04,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 0.96,
            "wind_deg": 42,
            "wind_gust": 0.74,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774238400,
            "temp": -10.54,
            "feels_like": -10.54,
            "pressure": 1019,
            "humidity": 92,
            "dew_point": -11.98,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.1,
            "wind_deg": 59,
            "wind_gust": 0.22,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774242000,
            "temp": -10.1,
            "feels_like": -10.1,
            "pressure": 1019,
            "humidity": 89,
            "dew_point": -11.92,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.26,
            "wind_deg": 85,
            "wind_gust": 2.62,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774245600,
            "temp": -10.52,
            "feels_like": -10.52,
            "pressure": 1019,
            "humidity": 93,
            "dew_point": -11.88,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.28,
            "wind_deg": 80,
            "wind_gust": 2.66,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774249200,
            "temp": -10.06,
            "feels_like": -13.48,
            "pressure": 1019,
            "humidity": 92,
            "dew_point": -11.46,
            "uvi": 0,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.62,
            "wind_deg": 76,
            "wind_gust": 5.07,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774252800,
            "temp": -11.14,
            "feels_like": -14.09,
            "pressure": 1020,
            "humidity": 93,
            "dew_point": -12.54,
            "uvi": 0,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 1.34,
            "wind_deg": 74,
            "wind_gust": 3.13,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774256400,
            "temp": -11.92,
            "feels_like": -15.02,
            "pressure": 1020,
            "humidity": 94,
            "dew_point": -13.18,
            "uvi": 0,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 1.36,
            "wind_deg": 72,
            "wind_gust": 2.59,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774260000,
            "temp": -10.62,
            "feels_like": -13.5,
            "pressure": 1020,
            "humidity": 90,
            "dew_point": -12.3,
            "uvi": 0,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 1.34,
            "wind_deg": 76,
            "wind_gust": 3.67,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04n"
            }],
            "pop": 0
        },
        {
            "dt": 1774263600,
            "temp": -10.38,
            "feels_like": -10.38,
            "pressure": 1020,
            "humidity": 88,
            "dew_point": -12.44,
            "uvi": 0.1,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 1.33,
            "wind_deg": 66,
            "wind_gust": 3.55,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774267200,
            "temp": -8.83,
            "feels_like": -11.95,
            "pressure": 1020,
            "humidity": 76,
            "dew_point": -12.46,
            "uvi": 0.46,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 1.56,
            "wind_deg": 81,
            "wind_gust": 4.09,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774270800,
            "temp": -7.05,
            "feels_like": -10.77,
            "pressure": 1021,
            "humidity": 69,
            "dew_point": -11.74,
            "uvi": 1.15,
            "clouds": 99,
            "visibility": 10000,
            "wind_speed": 2.07,
            "wind_deg": 83,
            "wind_gust": 3.72,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774274400,
            "temp": -5.3,
            "feels_like": -8.79,
            "pressure": 1021,
            "humidity": 66,
            "dew_point": -10.39,
            "uvi": 2.21,
            "clouds": 98,
            "visibility": 10000,
            "wind_speed": 2.11,
            "wind_deg": 84,
            "wind_gust": 3.17,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774278000,
            "temp": -4.03,
            "feels_like": -7,
            "pressure": 1020,
            "humidity": 65,
            "dew_point": -9.46,
            "uvi": 3.14,
            "clouds": 100,
            "visibility": 10000,
            "wind_speed": 1.9,
            "wind_deg": 83,
            "wind_gust": 2.69,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774281600,
            "temp": -3.34,
            "feels_like": -5.74,
            "pressure": 1020,
            "humidity": 61,
            "dew_point": -9.62,
            "uvi": 3.11,
            "clouds": 100,
            "visibility": 8920,
            "wind_speed": 1.6,
            "wind_deg": 69,
            "wind_gust": 2.56,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774285200,
            "temp": -2.54,
            "feels_like": -4.79,
            "pressure": 1019,
            "humidity": 58,
            "dew_point": -9.46,
            "uvi": 3.21,
            "clouds": 100,
            "visibility": 6854,
            "wind_speed": 1.58,
            "wind_deg": 47,
            "wind_gust": 2.69,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774288800,
            "temp": -2.33,
            "feels_like": -4.9,
            "pressure": 1018,
            "humidity": 60,
            "dew_point": -8.72,
            "uvi": 2.6,
            "clouds": 100,
            "visibility": 7262,
            "wind_speed": 1.81,
            "wind_deg": 23,
            "wind_gust": 2.42,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "pop": 0
        },
        {
            "dt": 1774292400,
            "temp": -2.59,
            "feels_like": -6.2,
            "pressure": 1018,
            "humidity": 69,
            "dew_point": -7.21,
            "uvi": 1.83,
            "clouds": 98,
            "visibility": 3464,
            "wind_speed": 2.6,
            "wind_deg": 357,
            "wind_gust": 2.72,
            "weather": [{
                "id": 600,
                "main": "Snow",
                "description": "light snow",
                "icon": "13d"
            }],
            "pop": 0.32,
            "snow": {
                "1h": 0.1
            }
        },
        {
            "dt": 1774296000,
            "temp": -3.37,
            "feels_like": -7.85,
            "pressure": 1019,
            "humidity": 80,
            "dew_point": -6.14,
            "uvi": 0.98,
            "clouds": 100,
            "visibility": 1259,
            "wind_speed": 3.32,
            "wind_deg": 346,
            "wind_gust": 3.52,
            "weather": [{
                "id": 600,
                "main": "Snow",
                "description": "light snow",
                "icon": "13d"
            }],
            "pop": 0.51,
            "snow": {
                "1h": 0.13
            }
        }
    ],
    "daily": [{
            "dt": 1774108800,
            "sunrise": 1774089015,
            "sunset": 1774132966,
            "moonrise": 1774091580,
            "moonset": 1774147140,
            "moon_phase": 0.1,
            "summary": "Expect a day of partly cloudy with snow",
            "temp": {
                "day": -3.46,
                "min": -12.7,
                "max": -3.46,
                "night": -12.55,
                "eve": -4.31,
                "morn": -8.4
            },
            "feels_like": {
                "day": -8.81,
                "night": -15.95,
                "eve": -9.56,
                "morn": -8.4
            },
            "pressure": 1011,
            "humidity": 71,
            "dew_point": -7.73,
            "wind_speed": 5.22,
            "wind_deg": 315,
            "wind_gust": 8.41,
            "weather": [{
                "id": 600,
                "main": "Snow",
                "description": "light snow",
                "icon": "13d"
            }],
            "clouds": 77,
            "pop": 1,
            "snow": 0.49,
            "uvi": 2.05
        },
        {
            "dt": 1774195200,
            "sunrise": 1774175289,
            "sunset": 1774219454,
            "moonrise": 1774179480,
            "moonset": 0,
            "moon_phase": 0.13,
            "summary": "There will be partly cloudy today",
            "temp": {
                "day": -4.19,
                "min": -14.16,
                "max": -3.39,
                "night": -10.78,
                "eve": -6,
                "morn": -14.16
            },
            "feels_like": {
                "day": -7.65,
                "night": -10.78,
                "eve": -10.45,
                "morn": -14.16
            },
            "pressure": 1014,
            "humidity": 58,
            "dew_point": -11.02,
            "wind_speed": 2.96,
            "wind_deg": 4,
            "wind_gust": 5.19,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "clouds": 92,
            "pop": 0,
            "uvi": 3
        },
        {
            "dt": 1774281600,
            "sunrise": 1774261563,
            "sunset": 1774305942,
            "moonrise": 1774267860,
            "moonset": 1774238700,
            "moon_phase": 0.17,
            "summary": "Expect a day of partly cloudy with snow",
            "temp": {
                "day": -3.34,
                "min": -11.92,
                "max": -2.33,
                "night": -11.67,
                "eve": -5.49,
                "morn": -10.62
            },
            "feels_like": {
                "day": -5.74,
                "night": -14.71,
                "eve": -10.51,
                "morn": -13.5
            },
            "pressure": 1020,
            "humidity": 61,
            "dew_point": -9.62,
            "wind_speed": 3.96,
            "wind_deg": 348,
            "wind_gust": 6.07,
            "weather": [{
                "id": 600,
                "main": "Snow",
                "description": "light snow",
                "icon": "13d"
            }],
            "clouds": 100,
            "pop": 0.57,
            "snow": 0.87,
            "uvi": 3.21
        },
        {
            "dt": 1774368000,
            "sunrise": 1774347838,
            "sunset": 1774392430,
            "moonrise": 1774357020,
            "moonset": 1774330020,
            "moon_phase": 0.21,
            "summary": "There will be partly cloudy today",
            "temp": {
                "day": -3.06,
                "min": -14.27,
                "max": -1.71,
                "night": -4.64,
                "eve": -2.14,
                "morn": -14.27
            },
            "feels_like": {
                "day": -7.75,
                "night": -9.78,
                "eve": -5.7,
                "morn": -14.27
            },
            "pressure": 1024,
            "humidity": 61,
            "dew_point": -9.28,
            "wind_speed": 3.85,
            "wind_deg": 302,
            "wind_gust": 10.4,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "clouds": 91,
            "pop": 0.05,
            "uvi": 3.22
        },
        {
            "dt": 1774454400,
            "sunrise": 1774434112,
            "sunset": 1774478918,
            "moonrise": 1774447080,
            "moonset": 1774420560,
            "moon_phase": 0.25,
            "summary": "The day will start with snow through the late morning hours, transitioning to partly cloudy",
            "temp": {
                "day": -12.09,
                "min": -13.38,
                "max": -4.59,
                "night": -13.38,
                "eve": -11.56,
                "morn": -4.59
            },
            "feels_like": {
                "day": -19.09,
                "night": -19.48,
                "eve": -18.56,
                "morn": -10.39
            },
            "pressure": 1021,
            "humidity": 65,
            "dew_point": -17.84,
            "wind_speed": 8,
            "wind_deg": 301,
            "wind_gust": 14.07,
            "weather": [{
                "id": 600,
                "main": "Snow",
                "description": "light snow",
                "icon": "13d"
            }],
            "clouds": 93,
            "pop": 1,
            "snow": 1.26,
            "uvi": 2.73
        },
        {
            "dt": 1774540800,
            "sunrise": 1774520386,
            "sunset": 1774565406,
            "moonrise": 1774537920,
            "moonset": 1774510200,
            "moon_phase": 0.28,
            "summary": "There will be partly cloudy until morning, then snow",
            "temp": {
                "day": -11.2,
                "min": -15.12,
                "max": -8.98,
                "night": -9.8,
                "eve": -8.98,
                "morn": -14.4
            },
            "feels_like": {
                "day": -18.2,
                "night": -9.8,
                "eve": -15.75,
                "morn": -18.13
            },
            "pressure": 1020,
            "humidity": 87,
            "dew_point": -13.28,
            "wind_speed": 5.68,
            "wind_deg": 112,
            "wind_gust": 9.25,
            "weather": [{
                "id": 601,
                "main": "Snow",
                "description": "snow",
                "icon": "13d"
            }],
            "clouds": 100,
            "pop": 1,
            "snow": 5.68,
            "uvi": 0.26
        },
        {
            "dt": 1774627200,
            "sunrise": 1774606661,
            "sunset": 1774651894,
            "moonrise": 1774629180,
            "moonset": 1774598940,
            "moon_phase": 0.32,
            "summary": "Expect a day of partly cloudy with snow",
            "temp": {
                "day": -5.81,
                "min": -15.69,
                "max": -5.81,
                "night": -15.69,
                "eve": -7.22,
                "morn": -13.73
            },
            "feels_like": {
                "day": -10.74,
                "night": -22.69,
                "eve": -14.22,
                "morn": -13.73
            },
            "pressure": 1009,
            "humidity": 74,
            "dew_point": -9.6,
            "wind_speed": 7.37,
            "wind_deg": 310,
            "wind_gust": 12.99,
            "weather": [{
                "id": 600,
                "main": "Snow",
                "description": "light snow",
                "icon": "13d"
            }],
            "clouds": 98,
            "pop": 1,
            "snow": 1.65,
            "uvi": 1
        },
        {
            "dt": 1774713600,
            "sunrise": 1774692935,
            "sunset": 1774738381,
            "moonrise": 1774720440,
            "moonset": 1774687020,
            "moon_phase": 0.35,
            "summary": "There will be partly cloudy today",
            "temp": {
                "day": -14.59,
                "min": -18.24,
                "max": -11.55,
                "night": -17.63,
                "eve": -11.55,
                "morn": -18.24
            },
            "feels_like": {
                "day": -21.59,
                "night": -23.63,
                "eve": -17.96,
                "morn": -25.24
            },
            "pressure": 1028,
            "humidity": 63,
            "dew_point": -20.91,
            "wind_speed": 5.62,
            "wind_deg": 305,
            "wind_gust": 10.6,
            "weather": [{
                "id": 804,
                "main": "Clouds",
                "description": "overcast clouds",
                "icon": "04d"
            }],
            "clouds": 100,
            "pop": 0,
            "uvi": 1
        }
    ]
});



const goodShit = decompressWeather(data);

console.log(goodShit);