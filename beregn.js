/* Faelles beregning til baade GitHub Action (Node) og siden (browser).
   Laver raa data fra Energi Data Service om til et doegn-objekt pr. dato.
   Alle beloeb i kr./kWh EKSKL. moms og ekskl. elselskabets tillaeg.

   Doegn-format:
   {
     spot:        [24]  timegennemsnit af spotprisen (null hvis timen mangler, fx ved sommertid)
     spotKvarter: [96]  spotpris pr. kvarter (til senere batteri/solcelle-styring)
     energinet:   [24]  transmissions nettarif + systemtarif + elafgift
     net:         { <adresse-id>: [24] }  netselskabets nettarif C
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
    for (var i = 0; i < poster.length; i++) {
      var r = poster[i];
      if (r.GLN_Number === gln && r.Note === note && gyldig(r, iso)) return r;
    }
    return null;
  }

  /* spotRecords: DayAheadPrices-records (TimeDK, DayAheadPriceDKK)
     prisRecords: DatahubPricelist-records
     config: indholdet af config.json
     Returnerer { dage: {iso: doegn}, mangler: [tekst] } */
  function byggDage(spotRecords, prisRecords, config) {
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

      var net = {};
      config.adresser.forEach(function (a) {
        var p = null;
        for (var i = 0; i < a.gln.length && !p; i++) p = find(poster, a.gln[i], a.tarifNote, iso);
        if (!p) { fejl.push(a.net + " " + a.tarifNote); return; }
        var arr = [];
        for (var h2 = 0; h2 < 24; h2++) arr.push(r5(timepris(p, h2)));
        net[a.id] = arr;
      });

      if (fejl.length) { mangler.push(iso + ": " + fejl.join(", ")); return; }

      var enArr = [];
      for (var h3 = 0; h3 < 24; h3++) {
        var s = 0; en.forEach(function (p) { s += timepris(p, h3); });
        enArr.push(r5(s));
      }
      dage[iso] = { spot: spot.map(r5), spotKvarter: q.map(r5), energinet: enArr, net: net };
    });
    return { dage: dage, mangler: mangler };
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
    config.adresser.forEach(function (a) {
      glns = glns.concat(a.gln);
      if (noter.indexOf(a.tarifNote) < 0) noter.push(a.tarifNote);
    });
    return {
      spot: API + "DayAheadPrices?filter=" + encodeURIComponent(JSON.stringify({ PriceArea: [config.prisomraade] })) +
        "&start=" + startIso + "T00:00&end=" + slutIso + "T00:00&sort=TimeDK%20asc&limit=0",
      priser: API + "DatahubPricelist?filter=" + encodeURIComponent(JSON.stringify({ GLN_Number: glns, Note: noter })) + "&limit=0"
    };
  }

  root.ElprisBeregn = { byggDage: byggDage, doegnResume: doegnResume, urls: urls, isoIDag: isoIDag, plusDage: plusDage, TZ: TZ };
})(typeof window !== "undefined" ? window : globalThis);
