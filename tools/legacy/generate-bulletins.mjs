// Generate PDF bulletins from bulletin data
import fs from 'fs';

// Read bulletin data
const bulletinData = JSON.parse(fs.readFileSync('D:\\base de paie\\bulletin_data_2026.json', 'utf8'));

console.log(`Generating PDF bulletins for ${bulletinData.length} employees...\n`);

// Group by month
const byMonth = {};
for (const b of bulletinData) {
  const key = `${b.mois}-${b.annee}`;
  if (!byMonth[key]) byMonth[key] = [];
  byMonth[key].push(b);
}

// Generate HTML for each month
for (const [monthKey, employees] of Object.entries(byMonth)) {
  const [mois, annee] = monthKey.split('-');
  const monthNames = ['', 'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const monthName = monthNames[parseInt(mois)];
  
  let html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Bulletins de Paie - ${monthName} ${annee}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #333; }
    .bulletin { page-break-after: always; border: 1px solid #ccc; padding: 15px; margin-bottom: 20px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0066cc; padding-bottom: 10px; margin-bottom: 15px; }
    .company-info { font-size: 12px; font-weight: bold; color: #0066cc; }
    .employee-info { text-align: right; }
    .section { margin-bottom: 15px; }
    .section-title { font-weight: bold; background: #f0f0f0; padding: 5px; margin-bottom: 5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
    th { background: #f5f5f5; }
    .total { font-weight: bold; background: #e8f4e8; }
    .net { font-size: 14px; font-weight: bold; color: #006600; text-align: right; margin-top: 10px; }
  </style>
</head>
<body>
`;

  for (const emp of employees) {
    html += `
  <div class="bulletin">
    <div class="header">
      <div class="company-info">
        <div>ANIMAL CITY</div>
        <div>SARL</div>
        <div>RN: 12345678/A</div>
      </div>
      <div class="employee-info">
        <div><strong>Bulletin de Paie</strong></div>
        <div>${monthName} ${annee}</div>
        <div>Matricule: ${emp.matricule}</div>
      </div>
    </div>
    
    <div class="section">
      <table>
        <tr><td><strong>Nom:</strong> ${emp.nom}</td><td><strong>Prénom:</strong> ${emp.prenom}</td></tr>
        <tr><td><strong>CIN:</strong> ${emp.cin}</td><td><strong>N° CNSS:</strong> ${emp.numero_cnss}</td></tr>
        <tr><td><strong>Fonction:</strong> ${emp.fonction}</td><td><strong>Catégorie:</strong> ${emp.categorie} - ${emp.echelon}</td></tr>
        <tr><td><strong>Situation fam.:</strong> ${emp.situation_fam === 'M' ? 'Marié(e)' : 'Célibataire'}</td><td><strong>Enfants:</strong> ${emp.nombre_enfants}</td></tr>
      </table>
    </div>
    
    <div class="section">
      <div class="section-title">GAINS</div>
      <table>
        <tr><td>Salaire de base</td><td style="text-align:right">${emp.salaire_brut.toFixed(3)} DT</td></tr>
        ${emp.majoration_hs > 0 ? `<tr><td>Heures supplémentaires (${emp.heures_supplementaires}h)</td><td style="text-align:right">${emp.majoration_hs.toFixed(3)} DT</td></tr>` : ''}
        ${emp.absences > 0 ? `<tr><td>Absences (${emp.absences} jours)</td><td style="text-align:right">-${(emp.salaire_brut / 26 * emp.absences).toFixed(3)} DT</td></tr>` : ''}
        <tr class="total"><td><strong>Total Gains</strong></td><td style="text-align:right"><strong>${emp.salaire_brut.toFixed(3)} DT</strong></td></tr>
      </table>
    </div>
    
    <div class="section">
      <div class="section-title">COTISATIONS SOCIALES</div>
      <table>
        <tr><td>CNSS (9,68%)</td><td style="text-align:right">${emp.cnss_salariale.toFixed(3)} DT</td></tr>
        <tr><td>IRPP (Barème LF 2025)</td><td style="text-align:right">${emp.irpp.toFixed(3)} DT</td></tr>
        <tr><td>CSS (0,5%)</td><td style="text-align:right">${emp.css_salariale.toFixed(3)} DT</td></tr>
        ${emp.avances > 0 ? `<tr><td>Avances</td><td style="text-align:right">${emp.avances.toFixed(3)} DT</td></tr>` : ''}
        <tr class="total"><td><strong>Total Retenues</strong></td><td style="text-align:right"><strong>${emp.total_retenues.toFixed(3)} DT</strong></td></tr>
      </table>
    </div>
    
    <div class="net">
      Net à payer: ${emp.net_a_payer.toFixed(3)} DT
    </div>
  </div>
`;
  }

  html += `</body></html>`;

  // Save HTML file
  const filename = `D:\\base de paie\\bulletins_${mois}_${annee}.html`;
  fs.writeFileSync(filename, html);
  console.log(`✓ Generated: ${filename} (${employees.length} bulletins)`);
}

console.log(`\nTotal bulletins generated: ${bulletinData.length}`);
console.log('\nTo convert to PDF, open the HTML files in a browser and print to PDF.');