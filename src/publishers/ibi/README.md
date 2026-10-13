# IBI News publisher

The stable tenant ID is `ibi`. The production source is the public sitemap index advertised by IBI at `https://www.ibinews.com/GoogleSiteMapIndex.aspx`, bounded to `*.article` URLs hosted by `ibinews.com`. The runtime uses the shared sitemap adapter and canonical `PublisherArticle` normalizer; no IBI-specific ranking path exists.

No private credentials are required for the configured source. The initial branding intentionally uses safe text/color fallbacks because a production logo/background asset was not supplied. Replace those values through the admin control plane when approved assets are available.

`fixtures/` contains sanitized test records only and is never used as production content.
