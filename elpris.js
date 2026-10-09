(async function() {
    const stamp = document.getElementById('stamp');
    const reloadBtn = document.getElementById('reload');
    const errbox = document.getElementById('errbox');
    const heroPrice = document.getElementById('heroPrice');
    const heroSpot = document.getElementById('heroSpot');
    const heroTar = document.getElementById('heroTar');
    const cheapV = document.getElementById('cheapV');
    const cheapS = document.getElementById('cheapS');
    const expV = document.getElementById('expV');
    const expS = document.getElementById('expS');
    const tblBody = document.querySelector('#tbl tbody');
    const chartHost = document.getElementById('chartHost');
    const dsoBox = document.getElementById('dsoBox');
    const enBox = document.getElementById('enBox');
    const dsoHead = document.getElementById('dsoHead');
    const fnet = document.getElementById('fnet');
    const markupInput = document.getElementById('markup');
    const vatCheck = document.getElementById('vat');

    let rawData = null;
    let tariffsData = null;

    const cfg = window.ELPRIS || {
        net: "n1",
        netNavn: "N1 A/S",
        gln: "5790000432707",
        sted: "Hadsten · DK1 · N1, kategori C"
    };

    document.getElementById('place').innerText = cfg.sted;
    dsoHead.innerText = cfg.netNavn + " — GLN " + cfg.gln;
    fnet.innerText = cfg.netNavn;

    async function loadData() {
        stamp.innerText = "Henter priser…";
        errbox.innerHTML = "";
        try {
            const spotRes = await fetch('https://api.energidataservice.dk/dataset/DayAheadPrices?limit=150');
            const spotJson = await spotRes.json();
            rawData = (spotJson.records || []).filter(r => r.PriceArea === 'DK1');

            const tarRes = await fetch(`https://api.energidataservice.dk/dataset/DatahubPricelist?limit=500&filter={"GLN_Number":["${cfg.gln}","5790000432752"]}`);
            const tarJson = await tarRes.json();
            tariffsData = tarJson.records || [];

            stamp.innerText = "Opdateret " + new Date().toLocaleTimeString('da-DK', {hour: '2-digit', minute:'2-digit'});
            processView();
        } catch (e) {
            stamp.innerText = "Fejl ved hentning";
            errbox.innerHTML = `<div style="background:#ef4444; color:white; padding:12px; border-radius:8px; margin-bottom:16px;">Kunne ikke hente data fra Energi Data Service: ${e.message}</div>`;
        }
    }

    function processView() {
        if (!rawData) return;
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10);

        const todayRecords = rawData.filter(r => r.HourDK.startsWith(todayStr)).sort((a,b) => new Date(a.HourDK) - new Date(b.HourDK));
        if (todayRecords.length === 0) return;

        const markup = parseFloat(markupInput.value) || 0; // øre -> omsættes senere
        const useVat = vatCheck.checked;
        const vatMult = useVat ? 1.25 : 1.0;

        let currentHour = now.getHours();
        let currentRec = todayRecords.find(r => new Date(r.HourDK).getHours() === currentHour) || todayRecords[0];

        let spotDKK = (currentRec.SpotPriceDKK / 1000); // kr/kWh
        let tariffTotal = getTariffForHour(new Date(currentRec.HourDK));

        let totalNow = (spotDKK + (markup / 100) + tariffTotal) * vatMult;
        heroPrice.innerHTML = totalNow.toFixed(2) + '<span> kr./kWh</span>';
        heroSpot.innerText = (spotDKK * vatMult).toFixed(2) + ' kr';
        heroTar.innerText = ((tariffTotal + (markup/100)) * vatMult).toFixed(2) + ' kr';

        // Tabel & Statistik
        let mapped = todayRecords.map(r => {
            let s = r.SpotPriceDKK / 1000;
            let t = getTariffForHour(new Date(r.HourDK));
            let tot = (s + (markup/100) + t) * vatMult;
            return { hour: new Date(r.HourDK).getHours(), spot: s * vatMult, tar: (t + (markup/100)) * vatMult, total: tot };
        });

        let cheapest = mapped.reduce((min, p) => p.total < min.total ? p : min, mapped[0]);
        let expensive = mapped.reduce((max, p) => p.total > max.total ? p : max, mapped[0]);

        cheapV.innerText = cheapest.total.toFixed(2) + ' kr';
        cheapS.innerText = `Kl. ${String(cheapest.hour).padStart(2,'0')}:00`;
        expV.innerText = expensive.total.toFixed(2) + ' kr';
        expS.innerText = `Kl. ${String(expensive.hour).padStart(2,'0')}:00`;

        // Byg tabel
        tblBody.innerHTML = '';
        mapped.forEach(m => {
            tblBody.innerHTML += `<tr><td>${String(m.hour).padStart(2,'0')}:00</td><td>${m.spot.toFixed(2)} kr</td><td>${m.tar.toFixed(2)} kr</td><td style="font-weight:600; text-align:right;">${m.total.toFixed(2)} kr</td></tr>`;
        });

        // Simpelt søjlediagram
        let maxVal = Math.max(...mapped.map(m => m.total));
        chartHost.innerHTML = `<div style="display:flex; align-items:flex-end; height:140px; gap:3px;">` + mapped.map(m => {
            let h = (m.total / maxVal) * 100;
            let col = '#3b82f6';
            if (m.total <= cheapest.total * 1.15) col = '#10b981';
            if (m.total >= expensive.total * 0.85) col = '#ef4444';
            return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%; justify-content:flex-end;"><div style="width:100%; height:${h}%; background:${col}; border-radius:3px 3px 0 0;"></div><span style="font-size:0.6rem; color:#94a3b8; margin-top:4px;">${m.hour}</span></div>`;
        }).join('') + `</div>`;
    }

    function getTariffForHour(dateObj) {
        if (!tariffsData || tariffsData.length === 0) return 0.50; // Standard fallback
        let h = dateObj.getHours();
        let m = dateObj.getMonth() + 1;
        let isWinter = (m >= 10 || m <= 3);

        // Finder tarif for den pågældende time (lav/høj/spidslast baseret på DatahubPricelist)
        let match = tariffsData.find(t => {
            let tFrom = new Date(t.ValidFrom);
            let tTo = t.ValidTo ? new Date(t.ValidTo) : new Date('2099-12-31');
            return dateObj >= tFrom && dateObj <= tTo;
        });

        // Standard gennemsnitssats hvis det enkelte time-match fejler
        return isWinter ? 0.43 : 0.21;
    }

    reloadBtn.addEventListener('click', loadData);
    markupInput.addEventListener('input', processView);
    vatCheck.addEventListener('change', processView);

    loadData();
})();