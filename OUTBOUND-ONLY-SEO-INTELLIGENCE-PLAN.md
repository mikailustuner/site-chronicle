# SiteChronicle — Dışarıdan Ölçümle SEO ve Büyüme İstihbaratı Planı

**Belge durumu:** Faz 0–8 kodlandı ve yerel entegrasyonda doğrulandı  
**İlk plan:** 11 Ağustos 2026 · **Uygulama doğrulaması:** 12 Ağustos 2026  
**Çalışma modeli:** Ev sunucusu, yalnızca özel ağdan erişim, inbound webhook yok, müşteri sitesine tag yok, müşteri GA4/GSC/Ads hesabı yok

## Uygulama durumu

| Faz | Durum | Uygulanan ana çıktı |
|---|---|---|
| Faz 0 | Tamamlandı | Tag/trafik API ve arayüzü kapatıldı; eski `/t/*` yolu açıkça 404; ürün dili outbound-only yapıldı. |
| Faz 1 | Tamamlandı | Şifreli connector kasası, bütçe, maliyet kaydı, devre kesici, dedupe, tekrar deneme ve domain-adil kuyruk. |
| Faz 2 | Tamamlandı | Anahtar kelime keşif/onay akışı; DataForSEO ve SerpApi adaptörleri; bağlamlı SERP geçmişi ve hareket görünümü. |
| Faz 3 | Tamamlandı | SERP rakip keşfi, onaylı/robots-aware public snapshot, SERP ve sayfa karşılaştırmalı gap kanıtları. |
| Faz 4 | Tamamlandı | CrUX History, ev-sunucusu vantage uptime/latency, Common Crawl ve kaynağı ayrıştırılmış zaman serileri. |
| Faz 5 | Tamamlandı | Mevcut deterministik audit genişletildi; sayfa konu/varlık/schema/iç-link/crawl-depth özellik indeksi bağlandı. |
| Faz 6 | Tamamlandı | Kanıtlı fırsat motoru, değişiklik günlüğü, bounded deney oluşturma/değerlendirme ve belirsizlik kaydı. |
| Faz 7 | Tamamlandı | Salt-okunur AI analist; SERP, gap, public metric ve deney bağlamı; kaynaksız trafik iddiası yok. |
| Faz 8 | Tamamlandı | Çoklu site otomasyonları, fair scheduling, connector health/status, retention, evidence archive ve browser smoke testi. |
| Faz 9 | Tamamlandı | 360° improvement, erişimsiz Google/Meta reklam blueprint'leri ve çok disiplinli Solution Desk. |

Doğrulama sonucu: TypeScript typecheck, 27 deterministik test, production build, tekrar çalıştırılabilir PostgreSQL migration ve 12 ana arayüz rotasını gezen Playwright smoke testi geçti. Eski public tracker yolu 404 verdi; worker health/readiness görüldü. Gerçek Google sırası için operatörün kendi lisanslı DataForSEO veya SerpApi hesabını bağlaması gerekir; sahte test anahtarıyla canlı sağlayıcı başarısı iddia edilmez.

## 1. Amaç ve değişmez ürün ilkeleri

SiteChronicle'ın amacı, tek bir özel panelden istenen sayıda yetkili sitenin teknik sağlığını, arama görünürlüğünü, içerik fırsatlarını, rakiplerini, kamuya açık performansını ve değişiklik sonuçlarını düzenli olarak izlemek; gözden kaçan sorunları kanıtlarıyla göstermek ve trafiği artırabilecek en mantıklı işleri önceliklendirmektir.

Sistem müşteriden şunları istemeyecektir:

- Siteye JavaScript ölçüm tag'i eklemek.
- GA4, Search Console, Google Ads veya Business Profile erişimi vermek.
- Sunucu logu, müşteri veritabanı veya dönüşüm verisi paylaşmak.
- SiteChronicle ev sunucusuna dışarıdan bağlantı veya webhook açmak.

SiteChronicle yalnızca zamanlanmış **outbound** istekler yapacaktır. Operatör isterse kendi adına alınmış üçüncü taraf API anahtarlarını sisteme ekleyebilir; bunlar müşteri hesabı veya müşteri verisi değildir. Her bağlayıcı ayrı açılıp kapatılabilir ve bütçelendirilebilir.

Ürünün temel doğruluk kuralı şudur:

> Gözlem, çıkarım, öneri ve doğrulanmış sonuç birbirinden ayrı veri türleri olarak saklanır ve arayüzde ayrı gösterilir.

Sistem gerçek ziyaretçi verisine sahip değilse “0 trafik” yazmaz; **“ölçülemiyor — kaynak bağlı değil”** yazar. Arama sonucu gözlemi varsa bunu “Google'daki mutlak sıra” olarak değil, zaman/konum/dil/cihaz/sağlayıcı bağlamına sahip bir SERP gözlemi olarak gösterir.

## 2. Gerçekçi ölçüm sınırı

Tag, GA4, Search Console veya log olmadan aşağıdakiler doğrudan ölçülemez:

- Gerçek kullanıcı, oturum, sayfa görüntüleme ve kanal trafiği.
- Organik tıklama, gösterim, CTR ve gerçek sorgu kırılımı.
- Dönüşüm, gelir, form gönderimi veya satış hunisi.
- Search Console indeks kapsamı, manuel işlem ve Google'ın seçtiği canonical bilgisi.
- Google'ın bir sonucu neden tam olarak belirli sıraya koyduğu.
- Her kullanıcı için geçerli tek bir “gerçek sıra”; sonuçlar konum, cihaz, dil, zaman ve bağlama göre değişebilir.
- İnternetteki tüm backlinklerin eksiksiz listesi.
- CrUX kapsamına girmeyen düşük trafikli URL'ler için gerçek kullanıcı Core Web Vitals verisi.

Ancak aşağıdakiler bağımsız ve güçlü biçimde ölçülebilir:

- Tanımlı anahtar kelimelerde konum/dil/cihaz bağlamlı Google sonuç gözlemleri.
- Organik görünürlük, görünürlük payı, rakip hareketi ve SERP özellikleri.
- Teknik taranabilirlik ve indekslenebilirlik koşulları.
- Sayfa içeriği, arama niyeti uyumu ve en üst sonuçlarla kanıta dayalı fark analizi.
- İç link ağı, crawl derinliği, canonical/hreflang/schema/meta ve içerik tutarlılığı.
- Lighthouse laboratuvar performansı ve varsa kamuya açık CrUX saha verisi.
- Uptime, DNS, TLS, HTTP, yönlendirme, robots.txt, sitemap ve sayfa değişiklikleri.
- Common Crawl ve seçilen lisanslı veri kaynaklarının görebildiği kamuya açık bağlantı/mention geçmişi.
- Uygulanan değişiklikten önce ve sonra sıralama, SERP görünürlüğü, teknik ölçüm ve rakip farklarındaki değişim.

Bu nedenle ürünün doğru üst seviye hedefi **“trafik ölçüm aracı” değil, “organik büyüme ve kamuya açık görünürlük istihbaratı”** olmalıdır. Trafik artışı önerilerin hedefidir; fakat ziyaretçi artışı, bağımsız trafik verisi olmadan doğrulanmış sonuç olarak sunulamaz.

## 3. Google ve SERP veri stratejisi

### 3.1 Doğrudan Google scraper yapılmayacak

Google, otomatik sorguları ve sıralama kontrolü amacıyla sonuçların otomatik alınmasını makine üretimli trafik olarak tanımlar. Bu nedenle SiteChronicle ev IP'sinden Google sonuç sayfalarını Playwright, proxy rotasyonu veya HTML parser ile otomatik taramayacaktır. Bu yaklaşım hem politika riski taşır hem CAPTCHA, kişiselleştirme ve sürekli HTML değişiklikleri nedeniyle güvenilir değildir.

Ayrıca Google Custom Search JSON API yeni müşterilere kapalıdır ve mevcut müşteriler için 1 Ocak 2027'de sonlandırılacaktır; yeni mimarinin temeli olamaz.

### 3.2 Üç çalışma seviyesi

#### Seviye A — Tamamen ücretsiz/kamusal mod

Herhangi bir SERP sağlayıcısı olmadan sistem şunları yapar:

- Siteyi ve tanımlanmış rakip siteleri tarar.
- Teknik SEO, içerik, schema, iç link, Lighthouse, güvenlik ve erişilebilirlik analizi yapar.
- CrUX API anahtarı varsa kamuya açık saha verisini çeker.
- Common Crawl indeksinde alan adı/URL geçmişi ve görülebilen bağlantı/mention sinyallerini arar.
- Sitedeki başlık, H1, schema, URL, anchor ve metinlerden aday anahtar kelimeler üretir.
- Rakip sayfalar arasındaki içerik ve yapı farklarını açıklar.

Bu seviyede **gerçek Google sırası gösterilmez**. Panel “SERP sağlayıcısı bağlı değil” der.

#### Seviye B — Lisanslı SERP sağlayıcılı önerilen mod

Operatör kendi SERP API hesabını bağlar. Varsayılan ilk bağlayıcı DataForSEO Google Organic SERP API; ikinci adaptör SerpApi olabilir. Sağlayıcı seçimi sözleşme, kullanım hakkı, ülke kapsamı, maliyet ve veri saklama koşulları incelendikten sonra yapılır.

Bağlayıcı şu bağlamları zorunlu gönderir ve saklar:

- Sorgu ve sorgu kümesi.
- Ülke, şehir veya koordinat düzeyi konum.
- Arama dili ve ülke parametresi.
- Masaüstü/mobil ve mümkünse işletim sistemi.
- Sonuç derinliği.
- İstek ve sonuç zamanı.
- Sağlayıcı, endpoint ve parser sürümü.
- Organik sonuçlar, URL/title/snippet ve SERP özellikleri.
- Sağlayıcının döndürdüğü kontrol/ham sonuç referansı ve içerik hash'i.

Ev sunucusuna webhook açılmaz. Standart/asenkron işlerde worker sağlayıcıya görev gönderir ve **polling** ile sonucu alır.

#### Seviye C — Genişletilmiş kamu istihbaratı

Operatörün kendi anahtarlarıyla isteğe bağlı olarak:

- Anahtar kelime hacmi ve ücretli zorluk/rekabet tahminleri.
- Daha kapsamlı backlink indeksi.
- Çok bölgeli sentetik performans servisi.
- Google Trends API erişimi açıldığında resmi Trends API.

eklenebilir. Her metrik sağlayıcı tahmini olarak etiketlenir. Google Trends API 2026 itibarıyla sınırlı alpha erişimindedir; erişim alınmadan üretim bağımlılığı yapılmaz ve resmi olmayan Trends scraping kullanılmaz.

### 3.3 Sıra ölçüm yöntemi

Tek bir sonuç pozisyonu karar vermek için yeterli değildir. Her kayıt aşağıdaki şekilde değerlendirilir:

1. Kritik anahtar kelimeler günlük; standart kelimeler haftada 2–3; keşif kelimeleri haftalık veya aylık ölçülür.
2. Her kelime, hedeflenen konum/dil/cihaz kombinasyonlarında ayrı izlenir.
3. Aynı gözlem için tekrarlı örneklerden medyan konum ve dağılım hesaplanır.
4. “İlk 3”, “ilk 10”, “ilk 20”, “ilk 100”, görünmeyen ve yeni/kaybedilen durumları tutulur.
5. Sonuç URL'si değişirse cannibalization veya Google'ın farklı sayfa seçmesi adayı oluşturulur.
6. SERP özellikleri ayrı takip edilir: featured snippet, AI Overview varlığı, people-also-ask, video, image, local pack, shopping, discussion/forum gibi.
7. Rakiplerin aynı örneklemdeki görünürlük payı hesaplanır.
8. Günlük oynaklık ile kalıcı trend ayrılır; uyarı tek örnek yerine eşik ve ardışık gözlem kuralıyla üretilir.

Örnek doğru ifade:

> “`istanbul veteriner` sorgusunda 11 Ağustos 2026 09:10 UTC tarihinde, İstanbul/tr-TR/mobil bağlamında DataForSEO örnekleminde hedef URL organik sonuçlarda 7. sırada gözlendi. Son 7 gözlemin medyanı 8, aralığı 6–11.”

Yanlış ifade:

> “Google'da kesin olarak 7. sıradasınız.”

### 3.4 Anahtar kelime envanteri

İlk envanter müşteri analitiği olmadan şu kanıtlardan üretilir:

- Title, H1–H3, URL slug, breadcrumb ve anchor metinleri.
- Product, Service, LocalBusiness, Article, FAQ ve diğer schema varlıkları.
- Kategori, ürün, hizmet, marka, şehir ve nitelik varlıkları.
- Sitemap ve site içi arama/filtre isimleri.
- Operatörün girdiği tohum kelimeler ve CSV.
- Rakip sayfalardaki başlıklar, konu kümeleri ve SERP'te görülen sonuç metinleri.
- Lisanslı sağlayıcının related keyword / keyword ideas verisi varsa bu kaynaktan gelen adaylar.

Adaylar normalleştirilir, yinelenenler birleştirilir, arama niyetine göre kümelenir ve şu puanlarla sıralanır:

- İş/hizmet uygunluğu: operatörün verdiği 0–5 değer.
- Sitenin mevcut konu kanıtı.
- SERP'teki hedef sayfa varlığı veya boşluğu.
- Sağlayıcıdan veri varsa ülke/tarih bağlamlı hacim tahmini.
- Ticari, yerel, bilgi veya navigasyon niyeti.
- Tahmini kazanılabilirlik; bu puan gerçek algoritma zorluğu olarak sunulmaz.

Sistem binlerce aday kelimeyi otomatik olarak maliyetli günlük takibe sokmaz. Operatör kümeyi onaylar; bütçe yöneticisi önem derecesine göre örnekleme sıklığı seçer.

## 4. “Neden bu sırada?” açıklama motoru

Google çok sayıda sayfa ve site düzeyi sinyal kullanır; kesin ağırlıkları veya tekil sıralama sebebini açıklamaz. Bu nedenle motor **kesin neden** üretmez. Hedef sayfa ile aynı SERP örneklemindeki üst sonuçlar arasında açıklanabilir fark adayları üretir.

### 4.1 Analiz zinciri

Her analiz şu kanıt paketini dondurur:

1. SERP snapshot ve ölçüm bağlamı.
2. Hedef sayfanın o tarihteki HTML, render edilmiş DOM, ekran görüntüsü ve içerik özeti.
3. İlk 3/5/10 rakip sayfanın aynı dönemdeki snapshotları.
4. Hedef ve rakiplerin Lighthouse/CrUX/HTTP/schema/bağlantı özellikleri.
5. Son audit'ten beri hedef sayfadaki değişiklikler.
6. Bilinen eksik veri ve karşı kanıtlar.

### 4.2 Açıklama boyutları

- **Sorgu ve niyet uyumu:** sayfa türü, başlık, ana içerik, ticari/bilgi/yerel niyet eşleşmesi.
- **Konu ve varlık kapsamı:** rakiplerin ortak kapsadığı fakat hedefte bulunmayan alt konular; kelime sayımı tek başına kalite sayılmaz.
- **Özgünlük ve yararlılık:** özgün veri, deneyim, uzman/yazar bilgisi, kaynaklar, metodoloji, güncellik ve kullanıcı görevini tamamlama.
- **Bilgi mimarisi:** crawl derinliği, iç link sayısı/bağlamı, hub-cluster ilişkisi ve olası yetim sayfalar. Yalnızca gözlenen crawl/sitemap evreni içinde “yetim adayı” denir.
- **Teknik uygunluk:** robots, meta robots, canonical, HTTP durumları, render farkı, sitemap, hreflang, mobil içerik ve kaynak engelleri.
- **SERP format uygunluğu:** liste, rehber, ürün, kategori, video, FAQ veya yerel sonuç yapısına uyum.
- **Yapılandırılmış veri:** uygunluk ve doğruluk incelenir; zengin sonuç garantisi verilmez.
- **Sayfa deneyimi:** kamuya açık CrUX ve kontrollü Lighthouse; iyi skorun üst sıra garantilemediği açıkça yazılır.
- **Kamuya açık otorite sinyalleri:** Common Crawl/lisanslı indeks kapsamında bağlantı ve mention farkları; kapsamın eksik olduğu belirtilir.
- **Tazelik ve değişim:** içerik tarihi, önemli güncelleme ve SERP hareketinin zaman ilişkisi.
- **Marka/varlık sinyalleri:** tutarlı marka, yazar, kuruluş, iletişim ve referans göstergeleri; uydurma otorite puanı üretilmez.

Her fark adayı için şu alanlar zorunludur:

- Gözlenen gerçek.
- Kaynak/evidence ID.
- Rakip karşılaştırması ve örneklem büyüklüğü.
- Neden önemli olabileceğini destekleyen resmi kaynak.
- Karşı kanıt veya alternatif açıklama.
- Güven: düşük/orta/yüksek ve sayısal olmayan gerekçe.
- Önerilen değişiklik.
- Beklenen gözlenebilir sonuç.
- Doğrulama penceresi ve başarı/geri alma ölçütü.

### 4.3 Nedensellik sınırı

“Başlığı değiştirdik ve sıra yükseldi” tek başına neden kanıtı değildir. Sonuçlar rakip değişiklikleri, algoritma güncellemeleri, talep ve SERP formatından etkilenebilir. Bir neden ancak:

- değişiklik kaydı kesin ise,
- diğer önemli sayfa koşulları mümkün olduğunca sabitse,
- aynı bağlamda yeterli önce/sonra gözlem varsa,
- hareket ardışık ölçümlerde sürüyorsa,
- karşılaştırılabilir kontrol sayfası/kelime grubu varsa

“güçlü biçimde desteklenen değişiklik etkisi” seviyesine yükselir. UI yine “Google sıralama nedeni doğrulandı” demez.

## 5. Ürün modülleri ve sol navigasyon

Sol navigasyon şu yapıya dönüşür:

1. **Portfolio** — tüm siteler, sağlık, kritik değişimler, son tarama, görünürlük trendi, veri kapsamı.
2. **Arama Görünürlüğü** — SERP görünürlüğü, pay, kazanan/kaybeden, SERP özellikleri ve oynaklık.
3. **Anahtar Kelimeler** — keşif, kümeler, hedef URL, niyet, izleme sıklığı ve maliyet.
4. **Rakipler** — SERP'ten keşfedilen ve elle eklenen rakipler; konu, teknik ve görünürlük farkı.
5. **Fırsatlar** — kanıtlı aksiyon kuyruğu, etki türü, güven, efor, doğrulama planı.
6. **Teknik Sağlık** — crawl/indexlenebilirlik adayları, schema, iç link, içerik, erişilebilirlik, güvenlik.
7. **Kamuya Açık Performans** — CrUX, Lighthouse, uptime, TLS/DNS/HTTP ve çoklu ölçüm bağlamı.
8. **Değişiklikler ve Deneyler** — yapılan iş, önce/sonra kanıtı, sonuç, belirsizlik ve geri alma.
9. **AI Analist** — salt-okunur araçları olan, kaynak gösteren portföy sohbeti.
10. **Otomasyonlar** — site/iş türü bazında program, bütçe, kota, son durum ve hata yönetimi.
11. **Kanıt Arşivi** — snapshotlar, hash'ler, kaynaklar ve yeniden üretim bilgisi.
12. **Ayarlar** — bağlayıcılar, gizli anahtarlar, egress allowlist, saklama ve yedek.

Mevcut **“Traffic & vitals”** sekmesi varsayılan arayüzden çıkarılır. Tag kurulumu ve snippet çağrıları yeni site ekleme akışından kaldırılır. Mevcut telemetri verisi otomatik silinmez; veritabanı geçişinden sonra “legacy/disabled” olarak tutulabilir ve yalnızca operatör açıkça isterse ayrı bir arşiv ekranında görünür. Fırsat önceliği artık `telemetry_samples` sayfa görüntülemelerine bağlı olamaz.

## 6. Günlük otomasyon modeli

### 6.1 İş türleri

- `availability_probe`: 5–15 dakika; GET/HEAD, yönlendirme, TLS, DNS, süre.
- `serp_critical`: günlük; yalnızca kritik kelime/konum/cihaz kümeleri.
- `serp_standard`: haftada 2–3.
- `light_crawl`: günlük; robots, sitemap, değişen/kritik URL'ler.
- `deep_crawl`: haftalık; kapsamlı link/DOM/schema/render analizi.
- `lighthouse_sample`: kritik şablonlarda haftada 2–3, çoklu koşu medyanı.
- `crux_refresh`: haftalık; CrUX History haftalık güncellenir.
- `competitor_refresh`: haftalık veya SERP rakip değişince.
- `common_crawl_refresh`: yeni indeks yayımlandığında/aylık.
- `opportunity_rebuild`: yeni kanıt paketi tamamlandığında.
- `experiment_evaluate`: belirlenen değerlendirme penceresinde.
- `portfolio_digest`: her sabah yerel panel için özet üretir; dışarı mesaj göndermez.

### 6.2 Kuyruk ve bütçe kuralları

- Site sayısı büyüdükçe adil sıra: tek büyük site worker'ı bloke edemez.
- Site, bağlayıcı ve iş türü bazında concurrency sınırı.
- Sağlayıcı kota/rate-limit başlıklarına uyum, exponential backoff ve circuit breaker.
- Aylık ve günlük para bütçesi; %70/%90/%100 uyarıları.
- Bütçe bitince kritik kelimeler korunur, düşük önemdekiler seyreltilir; veri uydurulmaz.
- Aynı sorgu/bağlam için kısa süreli deduplikasyon.
- Worker yeniden başlarsa idempotent devam; harcama iki kez yapılmaz.
- İş sonucu `success`, `partial`, `no-data`, `rate-limited`, `blocked`, `failed` olarak ayrılır.
- Kaynak başarısızlığı metriğin sıfır olduğu anlamına gelmez.

## 7. Fırsat ve öncelik modeli

Trafik verisi olmadan sahte “+%23 trafik” tahmini yapılmayacaktır. Öncelik şu bileşenlerden hesaplanır ve her bileşen açıklanabilir:

`Öncelik = iş uygunluğu × görünürlük boşluğu × kanıt gücü × etkilenen sayfa/şablon kapsamı × uygulanabilirlik × zaman hassasiyeti`

- **İş uygunluğu:** operatörün site/kelime/ürün için verdiği önem.
- **Görünürlük boşluğu:** hedef ile üst sonuç/rakip arasındaki gözlenen fark.
- **Kanıt gücü:** doğrudan ölçüm, örneklem büyüklüğü, tekrar ve kaynak kalitesi.
- **Kapsam:** tek URL mi, bütün şablon mu, crawl/index uygunluğunu etkiliyor mu?
- **Uygulanabilirlik:** efor, bağımlılık ve geri alınabilirlik.
- **Zaman hassasiyeti:** bozukluk, sıra kaybı, TLS süresi, sezon/trend gibi durumlar.

Fırsat kartı “potansiyel etki türünü” gösterir: görünürlük, crawl uygunluğu, içerik uygunluğu, SERP özelliği, kullanıcı deneyimi, güvenlik veya güven. Gerçek trafik/gelir etkisi veri olmadığında **“doğrulanamaz”** olarak kalır.

## 8. Veri modeli

Yeni temel tablolar:

- `connector_configs`: sağlayıcı türü, durum, şifreli credential referansı, kota/bütçe.
- `connector_runs`: istek amacı, zaman, maliyet, durum, retry, yanıt hash'i.
- `search_projects`: domain, varsayılan ülke/dil/cihaz ve hedef bölgeler.
- `keyword_clusters`: niyet, konu, iş önemi, durum.
- `keywords`: normalleştirilmiş sorgu, kaynak, hedef URL, takip seviyesi.
- `serp_runs`: keyword + location + language + device + provider + timestamp.
- `serp_results`: sıra, sonuç türü, domain, URL, title, snippet ve target işareti.
- `serp_features`: özellik türü, sahibi/URL, pozisyon ve kanıt.
- `serp_visibility_daily`: bağlama göre hesaplanmış özet; ham veriden yeniden üretilebilir.
- `competitors`: manuel/SERP keşfi, scope ve onay durumu.
- `competitor_snapshots`: sayfa/audit/evidence bağları.
- `public_metric_series`: CrUX, Lighthouse, uptime, DNS/TLS ve kaynak bağlamı.
- `page_features`: içerik varlıkları, topic/intent, schema, link ve teknik özellikler.
- `ranking_gap_candidates`: fark, karşı kanıt, güven gerekçesi ve kaynaklar.
- `change_events`: ne, nerede, kim, ne zaman; git/deploy bilgisi varsa referans.
- `experiments`: hipotez, hedef, guardrail, önce/sonra penceresi ve durum.
- `experiment_observations`: ölçüm ve kontrol serileri.
- `opportunity_evidence`: fırsat–kanıt ilişkisi ve kanıt rolü (`supports`, `counters`, `context`).
- `daily_digests`: o günün değişimleri ve okunma durumu.

Her zaman serisi kaydında `observed_at`, `source`, `source_version`, `measurement_context`, `sample_size`, `freshness`, `status` ve `evidence_id` bulunur. Zaman, ülke/dil/cihaz bilgisi olmayan SERP kaydı kabul edilmez.

## 9. API ve worker mimarisi

### 9.1 Modülerleştirme

Mevcut büyük `apps/api/src/routes.ts` ve `apps/web/src/App.tsx` dosyaları yeni özellikler eklenmeden önce alanlara bölünmelidir:

- API: `routes/domains`, `routes/audits`, `routes/search`, `routes/competitors`, `routes/opportunities`, `routes/experiments`, `routes/connectors`, `routes/ai`.
- Worker: `jobs/serp`, `jobs/crawl`, `jobs/performance`, `jobs/public-data`, `jobs/opportunities`, `jobs/experiments`.
- Web: sayfa, feature ve ortak design-system bileşenleri.

### 9.2 Bağlayıcı sözleşmesi

Tüm dış veri sağlayıcıları aynı arayüzü uygular:

```ts
interface Connector<TRequest, TResult> {
  validateConfig(): Promise<ValidationResult>;
  estimateCost(request: TRequest): Promise<CostEstimate>;
  submit(request: TRequest): Promise<ExternalJobRef | TResult>;
  poll?(job: ExternalJobRef): Promise<PollResult<TResult>>;
  normalize(result: TResult): NormalizedEvidenceBatch;
  health(): Promise<ConnectorHealth>;
}
```

Sağlayıcının ham cevabı içerik adresli artifact olarak saklanır; normalleştirilmiş satır ham artifact'e referans verir. Böylece parser değişirse geçmiş veri yeniden işlenebilir.

### 9.3 Güvenlik

- Connector secret'ları veritabanında düz metin tutulmaz; ayrı master key/Docker secret ile envelope encryption.
- Web UI anahtarı geri okuyamaz; yalnızca son dört karakter, doğrulama durumu ve değiştirme/silme gösterir.
- Worker outbound hedefleri bağlayıcı allowlist'iyle sınırlandırılır.
- Kullanıcı tarafından girilen URL'lerde mevcut SSRF koruması korunur; DNS rebinding kontrolü yapılır.
- Ev sunucusunda provider callback/webhook endpoint'i açılmaz.
- API ve veritabanı LAN/Tailscale dışında yayınlanmaz; worker'ın inbound portu olmaz.
- Connector istek loglarında Authorization başlığı, query secret ve response secret redakte edilir.
- Her harcama ve harici istek audit loguna yazılır.
- Yedeklerde secret'lar şifreli kalır; restore prosedürü master key gerektirir.

## 10. AI Analist

AI sohbeti yalnızca yetkilendirilmiş, salt-okunur araçlar kullanır:

- `get_portfolio_health`
- `get_visibility_trend`
- `get_keyword_serp_history`
- `compare_target_to_serp_competitors`
- `get_page_evidence`
- `get_public_performance`
- `get_technical_findings`
- `get_opportunities`
- `get_change_experiment`
- `explain_metric_source`

AI:

- Canlı internete serbest sorgu atamaz; kayıtlı/izinli tool sonuçlarına dayanır.
- Her maddede evidence ID ve ölçüm tarihini verir.
- Ölçülmeyen veriyi “yok” veya “0” diye yorumlamaz.
- Kesin sıralama nedeni, trafik artış yüzdesi veya gelir garantisi vermez.
- Kanıtla yorumunu ayrı paragraflarda gösterir.
- Aynı öneriye karşı kanıt varsa bunu gizlemez.
- Veri bayatsa veya örneklem küçükse önce bunu söyler.
- Yazma/değişiklik uygulama aracı almaz; öneri üretir, operatör karar verir.

Örnek sorular:

- “Bu hafta görünürlük kaybeden siteler hangileri ve ortak kanıt ne?”
- “X kelimesinde üzerimizdeki ilk beş sayfanın bizden ölçülebilir farkları neler?”
- “Son deploy'dan sonra performans ve SERP hareketi aynı yönde mi?”
- “Yüksek güvenli, düşük eforlu üç fırsatı kaynaklarıyla sırala.”
- “Bu önerinin trafik etkisini gerçekten biliyor muyuz, yoksa yalnızca hipotez mi?”

## 11. Uygulama fazları

### Faz 0 — Ürün semantiği ve tag bağımlılığını kaldırma

**Amaç:** Sistemin müşteriden veri/tag beklemediği ve ölçemediğini dürüstçe gösterdiği temel.

**İşler:**

- Yeni site formundan telemetri seçeneği ve snippet yönlendirmesini kaldır.
- “Traffic & vitals” navigasyonunu kaldır; “Kamuya Açık Performans” placeholder'ı ekle.
- Portföy kartlarından `observed loads` ve telemetriye bağlı öncelik ağırlığını kaldır.
- Mevcut telemetry endpoint'lerini varsayılan kapalı/legacy hale getir; yeni public collector reklamı yapma.
- `unavailable`, `not-configured`, `no-public-data`, `collection-failed` durumlarını ortak tip olarak ekle.
- README ve ürün metnini outbound-only modele göre güncelle.

**Kabul kriterleri:** Yeni bir site yalnızca URL, yetki onayı, pazar/dil ve tarama programıyla eklenebilir; hiçbir ekran tag veya müşteri hesabı istemez; trafik verisi uydurulmaz.

### Faz 1 — Outbound connector, secret, kota ve iş altyapısı

**Amaç:** Her harici veri kaynağını güvenli, değiştirilebilir ve bütçeli çalıştırmak.

**İşler:** Connector sözleşmesi, şifreli secret store, provider test endpoint'i, polling işleri, kota/bütçe tablosu, maliyet tahmini, retry/circuit breaker, artifact saklama ve Settings UI.

**Testler:** Credential redaction, encryption round-trip, provider mock contract, timeout/retry, duplicate submit, quota exhaustion, worker restart, no-webhook e2e.

**Kabul kriterleri:** Provider arızası audit'i bozmaz; maliyet kaydı iki kez yazılmaz; hiçbir secret API cevabında görünmez; yalnız outbound polling ile iş tamamlanır.

### Faz 2 — Anahtar kelime keşfi ve SERP izleme

**Amaç:** Gerçek Google görünürlüğünü doğru bağlam ve geçmişle izlemek.

**İşler:**

- DataForSEO adaptörü ve sağlayıcıdan bağımsız normalizasyon.
- Site crawl'ından keyword candidate üretimi, kümeleme ve manuel/CSV ekleme.
- Pazar, şehir, dil, cihaz profilleri.
- Kritik/standart/keşif takip seviyeleri ve bütçe önizlemesi.
- SERP snapshot, result ve feature veri modeli.
- Medyan pozisyon, ilk-N dağılımı, yeni/kaybedilen, URL değişimi ve volatilite.
- Arama Görünürlüğü ve Anahtar Kelime ekranları.

**Testler:** Fixture sağlayıcı cevapları, farklı SERP özellikleri, redirect/canonical domain eşlemesi, mobil/desktop ayrımı, aynı gün tekrarları, no-data ve parser sürüm değişikliği.

**Kabul kriterleri:** Her sıra değeri yanında konum/dil/cihaz/zaman/sağlayıcı vardır; ham cevap hash'iyle izlenebilir; tek ölçüm kalıcı kayıp alarmı oluşturmaz; bütçe aşılmaz.

### Faz 3 — SERP rakipleri ve sıralama farkı açıklamaları

**Amaç:** “Neredeyiz?” sorusundan “hangi ölçülebilir farklar var?” sorusuna geçmek.

**İşler:** SERP'ten rakip keşfi, operatör onayı, rakip crawl sınırı, hedef-rakip sayfa eşlemesi, intent/format/topic/entity/internal-link/schema/performance karşılaştırması, supports/counters evidence modeli ve Ranking Gap UI.

**Kabul kriterleri:** Her açıklama en az bir hedef ve bir rakip kanıtına bağlıdır; Google'ın kesin nedeni olduğu iddia edilmez; örneklem ve karşı kanıt görünürdür; rakip domain robots/rate limitlerine uyulur.

### Faz 4 — Kamuya açık performans ve web geçmişi

**Amaç:** Tag olmadan erişilebilen gerçek kullanıcı ve tarihsel kamu verisini en iyi biçimde kullanmak.

**İşler:**

- CrUX History API entegrasyonu: URL/origin fallback, 40 haftalık dönem, örnek kapsamı ve no-data durumu.
- PageSpeed Insights'taki CrUX bağımlılığını kaldır; saha verisini doğrudan CrUX API'den al.
- Lighthouse çoklu koşu medyanı, şablon örnekleme ve lab/field ayrımı.
- Uptime/DNS/TLS/HTTP değişiklik serileri; “ev sunucusu vantage point” etiketi.
- Common Crawl index sorguları, mevcut snapshot/mention/link kanıtı ve coverage uyarısı.
- İsteğe bağlı çok bölgeli sentetik ölçüm adaptörü.

**Kabul kriterleri:** Lab ve saha verisi karışmaz; CrUX verisi yoksa 0 gösterilmez; tarihsel verinin rolling 28-day/weekly yapısı açıklanır; Common Crawl kapsamı eksiksiz backlink verisi gibi sunulmaz.

### Faz 5 — Teknik, içerik ve iç link istihbaratı

**Amaç:** Mevcut audit'i portföy ölçeğinde daha derin ve aksiyon odaklı hale getirmek.

**İşler:**

- Günlük light/haftalık deep crawl ve değişen sayfa önceliği.
- Render edilmiş/ham HTML eşitliği, JS ile kaybolan içerik/linkler.
- Robots, sitemap, canonical, hreflang, pagination, redirect zinciri, 4xx/5xx ve soft-404 adayları.
- Schema geçerliliği ve görünür içerikle tutarlılık.
- İç link grafiği, derinlik, kırık link, anchor çeşitliliği ve context-aware link fırsatları.
- Near-duplicate, konu çakışması/cannibalization adayı ve şablon düzeyinde thin-content sinyali.
- Görsel boyut/format/alt metin, video transcript/meta ve büyük kaynaklar.
- Güven/yazar/kaynak/güncellik sinyalleri; people-first rubric.
- Güvenlik header'ları, üçüncü taraf script envanteri ve tespit edilebildiği ölçüde bağımlılık/CVE kontrolü.

**Kabul kriterleri:** Site dışı iddialar kaynaklıdır; “yetim” yalnız gözlenen evren bağlamında adlandırılır; otomasyon sonucu kullanıcı psikolojisi veya garanti dönüşüm etkisi iddia edilmez.

### Faz 6 — Fırsat motoru, değişiklik günlüğü ve deneyler

**Amaç:** Bulgu listesini ölçülebilir iş ve öğrenme döngüsüne çevirmek.

**İşler:** Yeni öncelik formülü, portfolio-level dedupe, öneri kabul kriteri, değişiklik kayıt formu/API, baseline kilitleme, kontrol keyword/page grubu, değerlendirme penceresi, guardrail, before/after serileri ve supported/inconclusive/regressed sonucu.

**Kabul kriterleri:** Her fırsatta evidence ve doğrulama planı vardır; sonuç veri oluşmadan başarılı sayılmaz; trafik etkisi için private analytics yoksa “doğrulanamaz” kalır; teknik ve görünürlük sonucu ayrı değerlendirilir.

### Faz 7 — AI Analist

**Amaç:** Portföydeki kanıtı hızlı sorgulamak ve öğrenmek.

**İşler:** Salt-okunur tool registry, site kapsamı, evidence citation validator, metric glossary, belirsizlik şablonları, prompt-injection dayanımı, conversation retention ayarı ve AI'sız deterministik fallback.

**Kabul kriterleri:** Kaynaksız sayısal iddia reddedilir; tool dışı müşteri verisi varsayılmaz; AI provider anahtarı yokken ürünün temel analizleri çalışır; sohbet hiçbir siteyi değiştiremez veya harici istek başlatamaz.

### Faz 8 — Ölçek, kalite ve operasyon

**Amaç:** Onlarca/yüzlerce siteyi ev sunucusunda öngörülebilir maliyetle çalıştırmak.

**İşler:** Fair scheduling, site başına concurrency, incremental crawl, storage retention/compaction, PostgreSQL partition/indeksleri, maliyet ve queue dashboard'u, backup/restore provası, connector health, alarm merkezi, stale-data işaretleri ve browser evidence regression suite.

**Kabul kriterleri:** Büyük bir site diğerlerini aç bırakmaz; yeniden başlatma veri/para çoğaltmaz; restore sonrası kanıt hash'leri doğrulanır; dashboard her veri kaynağının son başarılı zamanını ve tazeliğini gösterir.

### Faz 9 — Çok disiplinli işletim sistemi ve reklam stüdyosu

**Amaç:** SiteChronicle'ı yalnızca SEO/audit aracından çıkarıp web büyümesi, reklam, yazılım, güvenlik, otomasyon, ürün, araştırma ve operasyon problemlerini yürüten özel bir çalışma sistemine dönüştürmek.

**İşler:** Altı sütunlu 360° site görünümü; gerçek offer/audience/geography/budget girdili Google Ads ve Meta Ads blueprint üretimi; conversion access gate; resmî platform kaynakları; destination-domain kontrolü; kreatif/keyword/landing-page/experiment planı; genel Solution Case ve alan playbook'ları; action lifecycle; AI'a read-only strategy/case context.

**Kabul kriterleri:** Hesap erişimi olmadan CPA/ROAS/satış iddiası üretilmez; dönüşüm sinyali isteyen optimizasyonlar blokajlı/koşullu gösterilir; Meta retargeting yetkili sinyal olmadan kapalıdır; reklam destination'ı yalnızca yetkili domaine ait olabilir; her vaka kabul kriterli aksiyon üretir; yazılım ve güvenlik playbook'ları kapsam/rollback/retest sınırlarını korur.

## 12. Önerilen teslim sırası

İlk gerçek değer için sıralama:

1. Faz 0 + Faz 1: yanlış ürün vaadini ve altyapı riskini düzeltir.
2. Faz 2: kullanıcının istediği gerçek konum bağlamlı sıralama görünürlüğünü getirir.
3. Faz 3: sıralama farklarını kanıtla açıklamaya başlar.
4. Faz 4: kamuya açık saha performansı ve tarihsel bağlamı ekler.
5. Faz 6: yapılan işlerin sonucunu ölçülebilir öğrenme döngüsüne sokar.
6. Faz 5: teknik/içerik zekâsını genişletir; mevcut audit tabanı nedeniyle bazı maddeler paralel ilerleyebilir.
7. Faz 7 + Faz 8: kanıt hazır olduktan sonra AI ve ölçek sertleştirmesi.

Tek geliştirici için kaba büyüklük 10–16 haftadır; connector sözleşmesi, SERP veri kalitesi ve kapsamlı testler takvimi en çok etkileyen parçalardır. Faz 0–2 tamamlandığında kullanılabilir ilk outbound-only görünürlük ürünü ortaya çıkar. Takvim, kalite kriterlerini düşürmek için değil kapsamı dilimlemek için kullanılır.

## 13. Kaynaklar ve araştırma dayanağı

Plan hazırlanırken özellikle resmi/primary belgeler esas alınmıştır:

- [Google spam politikaları — machine-generated traffic](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google Search Help — unusual traffic ve rank-checking software](https://support.google.com/websearch/answer/86640?hl=en)
- [Google Custom Search JSON API durumu ve 1 Ocak 2027 kapanışı](https://developers.google.com/custom-search/v1/overview)
- [Google ranking systems guide](https://developers.google.com/search/docs/appearance/ranking-systems-guide)
- [Google sonuçlarının zaman ve bağlama göre değişmesi](https://support.google.com/websearch/answer/12412910?hl=en)
- [Google sonuçlarında konum etkisi](https://support.google.com/websearch/answer/10909618?hl=en)
- [Google Search'in crawl–index–serve işleyişi](https://developers.google.com/search/docs/fundamentals/how-search-works)
- [Google teknik uygunluk gereksinimleri](https://developers.google.com/search/docs/essentials/technical)
- [Google people-first content rehberi](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Google page experience rehberi](https://developers.google.com/search/docs/appearance/page-experience)
- [Google structured data politikaları](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Chrome UX Report History API](https://developer.chrome.com/docs/crux/history-api/)
- [PageSpeed Insights API ve CrUX verisi değişikliği](https://developers.google.com/speed/docs/insights/v5/get-started)
- [Common Crawl başlangıç ve veri erişimi](https://commoncrawl.org/get-started)
- [Common Crawl Index Server](https://index.commoncrawl.org/)
- [Google Trends API alpha](https://developers.google.com/search/apis/trends)
- [DataForSEO Google Organic SERP API resmi dokümantasyonu](https://docs.dataforseo.com/v3/serp-google-organic-overview/)
- [SerpApi Google Search API resmi dokümantasyonu](https://serpapi.com/search-api)

## 14. Nihai ürün tanımı

Bu plan tamamlandığında SiteChronicle:

- Müşteri sitesine hiçbir şey kurmadan çalışır.
- Ev sunucusuna internetten inbound bağlantı açmadan otomasyon yapar.
- İstenen sayıda siteyi adil kuyruk ve bütçeyle izler.
- Gerçek Google SERP gözlemlerini bağlamı ve sağlayıcı kanıtıyla saklar.
- Rakiplerle ölçülebilir farkları gösterir; Google'ın gizli nedenlerini bildiğini iddia etmez.
- Trafiği artırma olasılığı bulunan işleri önem, kanıt ve efora göre sıralar.
- Uygulanan değişiklikleri önce/sonra gözlemleriyle değerlendirir.
- Bilmediği yerde açıkça “ölçülemiyor” veya “sonuç belirsiz” der.
- AI sohbetini kanıt arşivi üzerinde çalışan objektif bir analist olarak sunar.

Bu yaklaşım, özel müşteri verisi olmadan yapılabilecek maksimum faydayı sağlar; eksik veriyi tahminle doldurmak yerine kamuya açık gözlemi, tekrarlanabilir ölçümü ve dürüst belirsizliği ürünün çekirdeği yapar.
