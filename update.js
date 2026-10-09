const fs = require("fs");

async function fetchPrices() {
    try {
        const res = await fetch("https://api.energidataservice.dk/dataset/DayAheadPrices?limit=48&sort=HourUTC%20DESC");
        const json = await res.json();
        const records = (json.records || []).filter(r => r.PriceArea === "DK1");
        
        const dates = [...new Set(records.map(r => r.HourDK.slice(0, 10)))];
        
        let daysObj = {};
        dates.forEach(d => {
            const dayRecs = records.filter(r => r.HourDK.startsWith(d)).sort((a,b) => new Date(a.HourDK) - new Date(b.HourDK));
            if(dayRecs.length > 0) {
                daysObj[d] = {
                    spot: dayRecs.map(r => (r.SpotPriceDKK || 0) / 1000),
                    dso: {
                        n1: { code: "C", note: "Nettarif C (Hadsten)", prices: dayRecs.map(r => {
                            const h = new Date(r.HourDK).getHours();
                            const isWinter = new Date(r.HourDK).getMonth() >= 9 || new Date(r.HourDK).getMonth() <= 2;
                            return isWinter ? (h>=17&&h<21?1.25:(h>=6&&h<24?0.43:0.14)) : (h>=17&&h<21?0.56:(h>=6&&h<24?0.21:0.14));
                        })},
                        konstant: { code: "C", note: "Konstant Nettarif C (Ebeltoft)", prices: dayRecs.map(r => {
                            const h = new Date(r.HourDK).getHours();
                            const isWinter = new Date(r.HourDK).getMonth() >= 9 || new Date(r.HourDK).getMonth() <= 2;
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
        console.error("Fejl under hentning:", err);
        process.exit(1);
    }
}

fetchPrices();
