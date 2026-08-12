# SiteChronicle — Çok Disiplinli Sağ Kol İşletim Sistemi

**Durum:** Uygulandı  
**Tarih:** 12 Ağustos 2026

## Amaç

SiteChronicle artık yalnızca site skoru gösteren bir denetim paneli değildir. Aynı özel çalışma alanında web büyümesi, reklam planlama, yazılım, güvenlik, otomasyon, ürün, araştırma ve operasyon problemlerini kanıt → hipotez → seçenek → aksiyon → kabul kriteri → sonuç döngüsünde yönetir.

Sistem dış hesap erişimi olmadan yapılabilecek işi maksimuma çıkarır; erişim gerektiren sonucu ise uydurmaz. Örneğin bir reklam hesabı olmadan kampanya yapısı, teklif–kitle uyumu, kreatif matrisi, landing-page hazırlığı, anahtar kelime başlangıç havuzu, riskler ve deney tasarımı üretilebilir. Harcama, dönüşüm, CPA, ROAS ve satış artışı ancak yetkili bir sonuç kaynağı varsa ölçülmüş kabul edilir.

## Uygulanan çalışma alanları

### 1. 360° Improvement

Her site altı bağımsız sütunda değerlendirilir:

1. Teknik uygunluk ve taranabilirlik.
2. Arama talebi ve bağlamlı görünürlük.
3. Teklif netliği ve dönüşüm hazırlığı.
4. Performans ve erişilebilirlik.
5. Güven ve pasif güvenlik duruşu.
6. Ücretli trafik almaya hazırlık.

Her sütun `measured`, `partial` veya `unavailable` durumunu, dayandığı kanıt sayısını, ilgili fırsatları ve yorum sınırını gösterir. Tek tıkla ilgili sütun için Solution Desk vakası ve alan playbook'u oluşturulur.

### 2. Ad Strategy Studio

Gerekli operatör girdileri:

- Gerçek teklif.
- Hedef kitle ve kimlerin uygun olmadığı.
- Coğrafya.
- Günlük bütçe ve para birimi.
- Yetkili domaine ait landing page.
- İş hedefi: satış, lead, trafik veya farkındalık.

Google Ads planı; kontrollü Search başlangıcı, kampanya bütçe yapısı, onaylı site kelimelerinden seed havuzu, insan incelemeli negatif aday kategorileri, reklam varlığı temaları, landing-page kontrolü ve deney tasarımı üretir. Dönüşüm sinyali yoksa PMax ve outcome bidding koşullu/blokajlıdır.

Meta Ads planı; hedefe uygun objective, prospecting/creative-test/rezerv yapısı, üç açılı kreatif matrisi, format listesi, placement ilkesi ve deney tasarımı üretir. Pixel/CAPI veya yetkili first-party kitle yoksa website retargeting kapalıdır; lead hedefinde Instant Form, çağrı veya click-to-message önerilir.

Her iki kanalda:

- Başka domaine destination verilmesi reddedilir.
- Uydurma testimonial, fiyat, kıtlık veya performans iddiası yasaktır.
- Negatif kelime, kitle ve exclusion önerileri otomatik uygulanmaz.
- Platform attribution, incrementality veya gerçek gelir olarak etiketlenmez.
- Tek değişkenli ve önceden karar kurallı deney istenir.

Dayanaklar güncel resmî platform kaynakları olarak her blueprint içinde saklanır:

- [Google Ads ad quality](https://support.google.com/google-ads/answer/156066?hl=en)
- [Google Ads negative keywords](https://support.google.com/google-ads/answer/2453972?hl=en)
- [Google Ads experiments](https://support.google.com/google-ads/answer/7281575?hl=en)
- [Google Performance Max lead generation](https://support.google.com/google-ads/answer/13775965?hl=en)
- [Meta campaign objectives](https://www.facebook.com/business/ads/ad-objectives)
- [Meta traffic objective](https://www.facebook.com/business/ads/ad-objectives/traffic)
- [Meta lead ads](https://www.facebook.com/business/ads/ad-objectives/lead-generation)
- [Meta creative strategy](https://www.facebook.com/business/ads/ad-creative)
- [Meta Advantage+ placements](https://www.facebook.com/business/ads/meta-advantage-plus/placements)

### 3. Solution Desk

Bir vaka siteye bağlı veya tamamen genel olabilir. Her vaka şu ortak sözleşmeyi taşır:

- Çözüldüğünde doğru olması gereken durum.
- Bilinen bağlam ve kısıtlar.
- Yetki ve veri sınırı.
- Öncelik ve yaşam döngüsü.
- Aksiyonların gerekçesi, talimatları ve kabul kriterleri.
- Tamamlanan aksiyon ve sonuç kaydı.

Alana göre ilk playbook:

- **Software:** reproduksiyon, izolasyon, seçenek/trade-off, küçük tam çözüm, test, rollback.
- **Security:** yazılı yetki, kapsam, threat model, pasif doğrulama, risk bağlamı, remediation ve retest.
- **Automation:** trigger/input/output, idempotency, dedupe, retry, timeout, secrets, insan onayı, observability ve runbook.
- **Advertising:** teklif/kitle/objective hizası, claim kontrolü ve kontrollü öğrenme döngüsü.
- **Growth:** funnel kısıtı, supporting/counterevidence, tersine çevrilebilir değişiklik ve eşdeğer önce/sonra penceresi.
- **Product:** kullanıcı işi ve desirability/usability/feasibility/viability risklerinden en riskli varsayımı test etme.
- **Operations:** talep–kuyruk–iş–handoff–tamamlama akışındaki darboğazı bulma.
- **Research:** primary source, tazelik, çelişki ve belirsizlik haritası.
- **Other:** en az üç farklı seçenek ve en ucuz ayrıştırıcı test.

## AI Analist rolü

AI artık audit, SERP ve fırsatların yanında Strategy Plan ve Solution Case verisini de salt-okunur bağlam olarak alır. Kod, güvenlik, otomasyon, growth, ürün ve operasyon sorularında:

- Yetki ve kapsamı söyler.
- Gözlem ile varsayımı ayırır.
- Darboğazı arar.
- Geri alınabilir adım ve kabul testi önerir.
- Risk ve karşı kanıtı görünür tutar.
- Aktif istismar veya geri döndürülemez harici eylem başlatmaz.

## Kanıtlanan entegrasyon

- Yeni migration boş PostgreSQL üzerinde kuruldu.
- Genel automation vakası üç aşamalı playbook ve kalıcı strategy plan üretti.
- Google lead blueprint'i outcome optimization'ı dönüşüm verisi olmadığı için doğru biçimde blokladı ve dört resmî kaynak sakladı.
- Meta lead blueprint'i Instant Form/call/message başlangıcını seçti, retargeting'i kapattı, üç kreatif konsepti ve beş resmî kaynak sakladı.
- Yetkili domain dışındaki landing page HTTP 400 ile reddedildi.
- 360° endpoint altı sütun ve veri sınırı döndürdü.
- Yeni üç ekran dahil tüm sol menü Playwright ile başarıyla gezildi.
- Typecheck, deterministik testler ve production build geçti.

## Kullanım sırası

1. Siteyi ekle ve mümkün olan ilk audit/SERP/public-performance gözlemlerini al.
2. `360° improvement` ekranında en zayıf ama kanıtı güçlü sütunu seç.
3. Uygulama işi için Solution Desk vakası oluştur; aksiyonları `doing/done/blocked` olarak yürüt.
4. Reklam gerekecekse gerçek teklif ve gerçek kitleyle Ad Strategy Studio blueprint'i oluştur.
5. Erişim yokken planı dışarıda uygulat; uydurma sonuç yazma.
6. Erişim veya yetkili aggregate sonuç sonradan verilirse önce kaynağını ve bağlamını kaydet, ardından deneyi değerlendir.
7. Öğrenileni vaka sonucuna ve bir sonraki playbook'a taşı.
