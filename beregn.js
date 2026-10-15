/* Faelles beregning til baade GitHub Action (Node) og siden (browser).
   Laver raa data fra Energi Data Service om til et doegn-objekt pr. dato.
   Alle beloeb i kr./kWh EKSKL. moms og ekskl. elselskabets tillaeg.

   Doegn-format:
   {
     spot:        [24]  timegennemsnit af spotprisen (null hvis timen mangler, fx ved sommertid)
     spotKvarter: [96]  spotpris pr. kvarter (til senere batteri/solcelle-styring)
     energinet:   [24]  transmissions nettarif + systemtarif + elafgift
     net:         { <adresse-id>: [24] }  netselskabets nettarif C, MED eventuel rabat trukket fra
     netRabat:    { <adresse-id>: [24] }  rabatten alene (negativ eller 0), til visning
     co2:         [24]  g CO2/kWh i DK1 pr. time: maalt hvor det findes, ellers Energinets prognose (kan mangle)
   }
*/
(function (root) {
  "use strict";
  var TZ = "Europe/Copenhagen";

  function isoIDag(d) { return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(d || new Date()); }
  function plusDage(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function r5(v) { return v == null ? null : Math.round(v * 1e5) / 1e5; }

  function gyldig(r, iso) {
    return r.ValidFrom.slice(0, 10) <= iso && (!r.ValidTo || r.ValidTo.slice(0, 10) > iso);
  }
  function timepris(r, h) {
    var p = r["Price" + (h + 1)];
    return p == null ? (r.Price1 || 0) : p;
  }
  function find(poster, gln, note, iso) {
    var test = typeof note === "string" ? function (n) { return n === note; } : function (n) { return note.test(n); };
    for (var i = 0; i < poster.length; i++) {
      var r = poster[i];
      if (r.GLN_Number === gln && test(r.Note) && gyldig(r, iso)) return r;
    }
    return null;
  }
  /* Netselskabets rabat (fx Konstants andelsrabat). Navnet skifter over tid,
     derfor et moenster i config.json frem for et fast navn. */
  function rabatMoenster(a) { return a.rabat && a.rabat.moenster ? new RegExp(a.rabat.moenster, "i") : null; }

  /* spotRecords: DayAheadPrices-records (TimeDK, DayAheadPriceDKK)
     prisRecords: DatahubPricelist-records
     config: indholdet af config.json
     Returnerer { dage: {iso: doegn}, mangler: [tekst] } */
  /* CO2: 5-minutters vaerdier -> timegennemsnit pr. dato. Maalte vaerdier vinder over prognose. */
  function co2Timer(co2) {
    var ud = {};
    function laeg(records, felt) {
      (records || []).forEach(function (r) {
        if (r.CO2Emission == null) return;
        var iso = r.Minutes5DK.slice(0, 10), h = parseInt(r.Minutes5DK.slice(11, 13), 10);
        ud[iso] = ud[iso] || [];
        var c = ud[iso][h] = ud[iso][h] || { m: 0, mn: 0, p: 0, pn: 0 };
        if (felt === "m") { c.m += r.CO2Emission; c.mn++; } else { c.p += r.CO2Emission; c.pn++; }
      });
    }
    laeg(co2 && co2.maalt, "m"); laeg(co2 && co2.prognose, "p");
    var res = {};
    Object.keys(ud).forEach(function (iso) {
      var arr = [];
      for (var h = 0; h < 24; h++) {
        var c = ud[iso][h];
        arr.push(!c ? null : c.mn ? Math.round(c.m / c.mn) : (c.pn ? Math.round(c.p / c.pn) : null));
      }
      res[iso] = arr;
    });
    return res;
  }

  function byggDage(spotRecords, prisRecords, config, co2) {
    var co2PrDag = co2Timer(co2);
    var kv = {};   // iso -> 96 x {s,c}
    spotRecords.forEach(function (r) {
      if (r.DayAheadPriceDKK == null) return;
      var iso = r.TimeDK.slice(0, 10);
      var q = parseInt(r.TimeDK.slice(11, 13), 10) * 4 + Math.floor(parseInt(r.TimeDK.slice(14, 16), 10) / 15);
      if (!kv[iso]) { kv[iso] = []; for (var i = 0; i < 96; i++) kv[iso].push({ s: 0, c: 0 }); }
      kv[iso][q].s += r.DayAheadPriceDKK / 1000;   // kr./MWh -> kr./kWh
      kv[iso][q].c += 1;                          // to vaerdier i samme kvarter = vintertids-skiftet
    });

    // Nyeste prisposter foerst, saa en senere rettelse vinder over en aeldre
    var poster = prisRecords.slice().sort(function (a, b) { return a.ValidFrom < b.ValidFrom ? 1 : -1; });
    var dage = {}, mangler = [];

    Object.keys(kv).sort().forEach(function (iso) {
      var q = kv[iso].map(function (x) { return x.c ? x.s / x.c : null; });
      var spot = [];
      for (var h = 0; h < 24; h++) {
        var sum = 0, n = 0;
        for (var j = 0; j < 4; j++) { var v = q[h * 4 + j]; if (v != null) { sum += v; n++; } }
        spot.push(n ? sum / n : null);
      }

      var en = config.energinet.poster.map(function (note) { return find(poster, config.energinet.gln, note, iso); });
      var fejl = [];
      en.forEach(function (p, i) { if (!p) fejl.push("Energinet " + config.energinet.poster[i]); });

      var net = {}, netRabat = {};
      config.adresser.forEach(function (a) {
        var p = null, gln = null;
        for (var i = 0; i < a.gln.length && !p; i++) { p = find(poster, a.gln[i], a.tarifNote, iso); gln = a.gln[i]; }
        if (!p) { fejl.push(a.net + " " + a.tarifNote); return; }
        var rx = rabatMoenster(a), rb = rx ? find(poster, gln, rx, iso) : null;
        var arr = [], rArr = [];
        for (var h2 = 0; h2 < 24; h2++) {
          var rv = rb ? timepris(rb, h2) : 0;
          arr.push(r5(timepris(p, h2) + rv)); rArr.push(r5(rv));
        }
        net[a.id] = arr; netRabat[a.id] = rArr;
      });

      if (fejl.length) { mangler.push(iso + ": " + fejl.join(", ")); return; }

      var enArr = [];
      for (var h3 = 0; h3 < 24; h3++) {
        var s = 0; en.forEach(function (p) { s += timepris(p, h3); });
        enArr.push(r5(s));
      }
      dage[iso] = { spot: spot.map(r5), spotKvarter: q.map(r5), energinet: enArr, net: net, netRabat: netRabat };
      if (co2PrDag[iso] && co2PrDag[iso].some(function (v) { return v != null; })) dage[iso].co2 = co2PrDag[iso];
    });
    return { dage: dage, mangler: mangler };
  }

  /* Status for en dato uden spotpris - bruges af vagthunden til at se frem i tiden.
     Returnerer { mangler: [tekst], rabat: { <adresse-id>: true/false } } */
  function tarifStatus(prisRecords, config, iso) {
    var poster = prisRecords.slice().sort(function (a, b) { return a.ValidFrom < b.ValidFrom ? 1 : -1; });
    var mangler = [], rabat = {};
    config.energinet.poster.forEach(function (note) {
      if (!find(poster, config.energinet.gln, note, iso)) mangler.push("Energinet: " + note);
    });
    config.adresser.forEach(function (a) {
      var p = null, gln = null;
      for (var i = 0; i < a.gln.length && !p; i++) { p = find(poster, a.gln[i], a.tarifNote, iso); gln = a.gln[i]; }
      if (!p) { mangler.push(a.net + ": " + a.tarifNote); rabat[a.id] = false; return; }
      var rx = rabatMoenster(a);
      rabat[a.id] = !!(rx && find(poster, gln, rx, iso));
    });
    return { mangler: mangler, rabat: rabat };
  }

  /* Gennemsnit for et doegn pr. adresse (ekskl. moms og tillaeg) - til historikken */
  function doegnResume(iso, d, config) {
    var ud = { d: iso };
    var s = 0, n = 0;
    d.spot.forEach(function (v) { if (v != null) { s += v; n++; } });
    ud.spot = r5(n ? s / n : null);
    config.adresser.forEach(function (a) {
      var sum = 0, c = 0, min = null;
      d.spot.forEach(function (v, h) {
        if (v == null) return;
        var t = v + d.energinet[h] + d.net[a.id][h];
        sum += t; c++; if (min == null || t < min) min = t;
      });
      ud[a.id] = { snit: r5(c ? sum / c : null), min: r5(min) };
    });
    return ud;
  }

  function urls(config, startIso, slutIso) {
    var API = "https://api.energidataservice.dk/dataset/";
    var glns = [config.energinet.gln];
    var noter = config.energinet.poster.slice();
    var adrGln = [];
    config.adresser.forEach(function (a) {
      glns = glns.concat(a.gln); adrGln = adrGln.concat(a.gln);
      [a.tarifNote].concat(a.rabat && a.rabat.kendteNavne || []).forEach(function (n) { if (noter.indexOf(n) < 0) noter.push(n); });
    });
    return {
      spot: API + "DayAheadPrices?filter=" + encodeURIComponent(JSON.stringify({ PriceArea: [config.prisomraade] })) +
        "&start=" + startIso + "T00:00&end=" + slutIso + "T00:00&sort=TimeDK%20asc&limit=0",
      priser: API + "DatahubPricelist?filter=" + encodeURIComponent(JSON.stringify({ GLN_Number: glns, Note: noter })) + "&limit=0",
      // Alle kWh-tariffer for netselskaberne fra en given dato. Stor (flere MB) - kun til GitHub Action,
      // saa en rabat med et nyt navn ogsaa fanges af moensteret.
      // Alle Energinets kWh-poster (lille) - til vagthunden
      energinetBred: API + "DatahubPricelist?filter=" + encodeURIComponent(JSON.stringify({ GLN_Number: [config.energinet.gln], ChargeType: ["D03"] })) + "&limit=0",
      // CO2 for DK1 (5-minutters vaerdier): maalt og Energinets prognose
      co2: API + "CO2Emis?filter=" + encodeURIComponent(JSON.stringify({ PriceArea: [config.prisomraade] })) +
        "&start=" + startIso + "T00:00&end=" + slutIso + "T00:00&sort=Minutes5UTC%20asc&limit=0",
      co2Prognose: API + "CO2EmisProg?filter=" + encodeURIComponent(JSON.stringify({ PriceArea: [config.prisomraade] })) +
        "&start=" + startIso + "T00:00&end=" + slutIso + "T00:00&sort=Minutes5UTC%20asc&limit=0",
      // "Lige nu" - hentes af telefonen selv
      mixNu: API + "ElectricityProdex5MinRealtime?filter=" + encodeURIComponent(JSON.stringify({ PriceArea: [config.prisomraade] })) + "&sort=Minutes5UTC%20desc&limit=1",
      co2Nu: API + "CO2Emis?filter=" + encodeURIComponent(JSON.stringify({ PriceArea: [config.prisomraade] })) + "&sort=Minutes5UTC%20desc&limit=1",
      netBred: function (fraIso) {
        return API + "DatahubPricelist?filter=" + encodeURIComponent(JSON.stringify({ GLN_Number: adrGln, ChargeType: ["D03"] })) +
          "&start=" + fraIso + "&limit=0";
      }
    };
  }

  root.ElprisBeregn = { byggDage: byggDage, tarifStatus: tarifStatus, doegnResume: doegnResume, urls: urls, isoIDag: isoIDag, plusDage: plusDage, TZ: TZ };
})(typeof window !== "undefined" ? window : globalThis);
