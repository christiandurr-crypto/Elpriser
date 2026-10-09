const fs = require("fs");

async function fetchPrices() {
    try {
        console.log("Henter data for DK1 fra Energi Data Service...");
        
        // Henter poster uden sort-parameter i URL'en for at undgå HTTP 400-fejl
        const url = "https://api.energidataservice.dk/dataset/DayAheadPrices?limit=100";
        const res = await fetch(url);
        
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`HTTP fejl: ${res.status} - ${errText}`);
        }
        
        const json = await res.json();
        const records = (json.records || []).filter(r => r.PriceArea === "DK1");
        
        if (records.length === 0) {
            throw new Error("Ingen DK1-poster fundet i datasættet.");
        }
        
        const getHourStr = (r) => r.HourDK || r.HourUTC || "";
        
        const dates = [...new Set(records.map(r => getHourStr(r).slice(0, 10)))].filter(d => d.length === 10);
        console.log("Fundne datoer:", dates);
        
        let daysObj = {};
        dates.forEach(d => {
            const dayRecs = records.filter(r => getHourStr(r).startsWith(d)).sort((a,b) => new Date(getHourStr(a)) - new Date(getHourStr(b)));
            if(dayRecs.length > 0) {
                daysObj[d] = {
                    spot: dayRecs.map(r => (r.SpotPriceDKK || 0) / 1000),
                    dso: {
                        n1: { code: "C", note: "Nettarif C (Hadsten)", prices: dayRecs.map(r => {
                            const h = new Date(getHourStr(r)).getHours();
                            const isWinter = new Date(getHourStr(r)).getMonth() >= 9 || new Date(getHourStr(r)).getMonth() <= 2;
                            return isWinter ? (h>=17&&h<21?1.25:(h>=6&&h<24?0.43:0.14)) : (h>=17&&h<21?0.56:(h>=6&&h<24?0.21:0.14));
                        })},
                        konstant: { code: "C", note: "Konstant Nettarif C (Ebeltoft)", prices: dayRecs.map(r => {
                            const h = new Date(getHourStr(r)).getHours();
                            const isWinter = new Date(getHourStr(r)).getMonth() >= 9 || new Date(getHourStr(r)).getMonth() <= 2;
                            let base = isWinter ? (h>=17&&h<21?1.25:(h>=6&&h<24?0.43:0.14)) : (h>=17&&h<21?0.56:(h>=6&&h<24?0.21:0.14));
                            return base * 1.04;
                        })}
                    },
                    energinet: [
                        { note: "Transmissions nettarif", prices: dayRecs.map(() => 0.058) },
                        { note: "Systemtarif", prices: dayRecs.map(() => 0.073) },
                        { note: "Elafgift", prices: dayRecs.map(() => 0.761) }
                    ]
                };
            }
        });

        const finalData = {
            priceArea: "DK1",
            generated: new Date().toISOString(),
            days: daysObj
        };

        fs.writeFileSync("data.json", JSON.stringify(finalData, null, 2));
        console.log("data.json opdateret med succes!");
    } catch (err) {
        console.error("DETALJERET FEJL I SCRIPT:", err.message);
        process.exit(1);
    }
}

fetchPrices();
