import json
with open('extracted.json') as f:
    data = json.load(f)

total_ht0 = sum(d['ht0'] for d in data)
total_ht19 = sum(d['ht19'] for d in data)
total_tva = sum(d['tva19'] for d in data)
total_ttc = sum(d['ttc'] for d in data)
total_timbre = sum(d['timbre'] for d in data)
print(f"Total HT0: {total_ht0:.3f}")
print(f"Total HT19: {total_ht19:.3f}")
print(f"Total TVA: {total_tva:.3f}")
print(f"Total Timbre: {total_timbre:.3f} ({len(data)} x 1)")
print(f"Sum HT0+HT19+TVA+Timbre: {total_ht0+total_ht19+total_tva+total_timbre:.3f}")
print(f"Total TTC: {total_ttc:.3f}")
print(f"Count: {len(data)} invoices")

anomalies = 0
for d in data:
    calc = d['ht0'] + d['ht19'] + d['tva19'] + d['timbre']
    if abs(calc - d['ttc']) > 0.1:
        anomalies += 1
        print(f"ANOMALY: {d['numero']} calc={calc:.3f} ttc={d['ttc']:.3f} diff={calc-d['ttc']:.3f}")

if anomalies == 0:
    print("\nAll invoices balance OK!")
