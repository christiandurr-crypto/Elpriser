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
    const dsoHead = document.getElementById('dsoHead');
    const fnet = document.getElementById('fnet');
    const markupInput = document.getElementById('markup');
    const vatCheck = document.getElementById('vat');
    const locationSelect = document.getElementById('location-select');

    let rawData = null;

    const locations = {
        hadsten: { net: "n1", netNavn: "N1 A/S", gln: "5790000432707", sted: "Hadsten · DK1 · N1, kategori C" },
        ebeltoft: { net: "konstant", netNavn: "Konstant Net A/S", gln: "5790000432615", sted: "Ebeltoft · DK1 · Konstant, kategori C" }
    };

    let currentKey = localStorage.getItem('elpris_loc') || 'hadsten';
    if (locationSelect) {
        locationSelect.value = currentKey;
    }
    let cfg = locations[currentKey];

    function updateConfigUI() {
        cfg = locations[locationSelect ? locationSelect.value : 'hadsten'];
        document.getElementById('place').innerText = cfg.sted;
        dsoHead.innerText = cfg.netNavn + " — GLN " + cfg.gln;
        fnet.innerText = cfg.netNavn;
        if (rawData) processView();
    }

    async function loadData() {
        stamp.innerText = "Henter priser…";
        errbox.innerHTML = "";
        
        try {
            // Vi bruger en CORS-proxy til at sikre, at GitHub Pages må hente dataene fra Energinet uden browserblokering
            const targetUrl = encodeURIComponent("https://api.energidataservice.dk/dataset/DayAheadPrices?limit=200");
            const proxyUrl = `https://api.allorigins.win/raw?url=${targetUrl}`;

            const res = await fetch(proxyUrl);
            if (!res.ok) throw new Error("HTTP fejl " + res.status);

            const data = await res.json();
            rawData = (data.records || []).filter(r => r.PriceArea === 'DK1');

            if (rawData.length === 0) {
                throw new Error("Ingen DK1-data fundet i datasættet.");
            }

            stamp.innerText = "Opdateret " + new Date().toLocaleTimeString('da-DK', {hour: '2-digit', minute:'2-digit'});
            updateConfigUI();
        } catch (e) {
            stamp.innerText = "Fejl ved hentning";
            errbox.innerHTML = `<div style="background:#ef4444; color:white; padding:12px; border-radius:8px; margin-bottom:16px;">Kunne ikke hente priser: ${e.message}</div>`;
        }
    }

    function processView() {
        if (!rawData) return;
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        const todayRecords = rawData.filter(r => r.HourDK && r.HourDK.startsWith(todayStr)).sort((a,b) => new Date(a.HourDK) - new Date(b.HourDK));
        
        if (todayRecords.length === 0) {
            errbox.innerHTML = `<div style="background:#f59e0b; color:white; padding:12px; border-radius:8px; margin-bottom:16px;">Venter på at dagens priser frigives for ${todayStr}.</div>`;
            return;
        }

        const markup = parseFloat(markupInput.value) || 0;
        const useVat = vatCheck.checked;
        const vatMult = useVat ? 1.25 : 1.0;

        let currentHour = now.getHours();
        let currentRec = todayRecords.find(r => new Date(r.HourDK).getHours() === currentHour) || todayRecords[0];

        let spotDKK = (currentRec.SpotPriceDKK || 0) / 1000;
        let tariffTotal = getTariffForHour(new Date(currentRec.HourDK));

        // Ebeltoft (Konstant) tillæg på ca. 4% på nettariffen i forhold til Hadsten
        if (locationSelect && locationSelect.value === 'ebeltoft') {
            tariffTotal *= 1.04;
        }

        let totalNow = (spotDKK + (markup / 100) + tariffTotal) * vatMult;
        heroPrice.innerHTML = totalNow.toFixed(2) + '<span> kr./kWh</span>';
        heroSpot.innerText = (spotDKK * vatMult).toFixed(2) + ' kr';
        heroTar.innerText = ((tariffTotal + (markup/100)) * vatMult).toFixed(2) + ' kr';

        let mapped = todayRecords.map(r => {
            let s = (r.SpotPriceDKK || 0) / 1000;
            let t = getTariffForHour(new Date(r.HourDK));
            if (locationSelect && locationSelect.value === 'ebeltoft') t *= 1.04;
            let tot = (s + (markup/100) + t) * vatMult;
            return { hour: new Date(r.HourDK).getHours(), spot: s * vatMult, tar: (t + (markup/100)) * vatMult, total: tot };
        });

        let cheapest = mapped.reduce((min, p) => p.total < min.total ? p : min, mapped[0]);
        let expensive = mapped.reduce((max, p) => p.total > max.total ? p : max, mapped[0]);

        cheapV.innerText = cheapest.total.toFixed(2) + ' kr';
        cheapS.innerText = `Kl. ${String(cheapest.hour).padStart(2,'0')}:00`;
        expV.innerText = expensive.total.toFixed(2) + ' kr';
        expS.innerText = `Kl. ${String(expensive.hour).padStart(2,'0')}:00`;

        tblBody.innerHTML = '';
        mapped.forEach(m => {
            tblBody.innerHTML += `<tr><td>${String(m.hour).padStart(2,'0')}:00</td><td>${m.spot.toFixed(2)} kr</td><td>${m.tar.toFixed(2)} kr</td><td style="font-weight:600; text-align:right;">${m.total.toFixed(2)} kr</td></tr>`;
        });

        let maxVal = Math.max(...mapped.map(m => m.total));
        chartHost.innerHTML = `<div style="display:flex; align-items:flex-end; height:140px; gap:3px;">` + mapped.map(m => {
            let h = maxVal > 0 ? (m.total / maxVal) * 100 : 0;
            let col = '#3b82f6';
            if (m.total <= cheapest.total * 1.15) col = '#10b981';
            if (m.total >= expensive.total * 0.85) col = '#ef4444';
            return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; height:100%; justify-content:flex-end;"><div style="width:100%; height:${h}%; background:${col}; border-radius:3px 3px 0 0;"></div><span style="font-size:0.6rem; color:#94a3b8; margin-top:4px;">${m.hour}</span></div>`;
        }).join('') + `</div>`;
    }

    function getTariffForHour(dateObj) {
        let h = dateObj.getHours();
        let m = dateObj.getMonth() + 1;
        let isWinter = (m >= 10 || m <= 3); // Oktober til marts

        // Tarifmodel 3.0 (Nettarif C) inkl. statslig elafgift (0,761 kr.) og systemtarif (0,131 kr.)
        let net = 0.14;
        if (isWinter) {
            if (h >= 17 && h < 21) net = 1.25; // Spidslast
            else if (h >= 6 && h < 24) net = 0.43; // Højlast
        } else {
            if (h >= 17 && h < 21) net = 0.56; // Spidslast sommer
            else if (h >= 6 && h < 24) net = 0.21; // Højlast sommer
        }

        const elafgift = 0.761;
        const energinet = 0.131;
        return net + elafgift + energinet;
    }

    if (locationSelect) {
        locationSelect.addEventListener('change', (e) => {
            localStorage.setItem('elpris_loc', e.target.value);
            updateConfigUI();
        });
    }

    reloadBtn.addEventListener('click', loadData);
    markupInput.addEventListener('input', processView);
    vatCheck.addEventListener('change', processView);

    loadData();
})();
