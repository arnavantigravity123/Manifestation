using System;
using System.Collections;
using UnityEngine;
// RevenueCat Unity SDK namespace — install via Package Manager
// https://github.com/RevenueCat/purchases-unity
using Purchases;

namespace Manifestation.Monetisation
{
    /// <summary>
    /// RevenueCat Purchases Manager (Singleton).
    ///
    /// Handles:
    ///   • SDK initialisation on startup
    ///   • VIP Pass entitlement check (unlocks all skins, no ads)
    ///   • Coin bundle purchases (100, 500, 1000 coins)
    ///   • Restore purchases
    ///
    /// Think of RevenueCat like a shop clerk that talks to the App Store/
    /// Google Play for you — you just say "buy this" and it handles all the
    /// receipt verification and currency conversion behind the scenes.
    ///
    /// IMPORTANT: Replace the API key placeholders before releasing!
    /// </summary>
    public class PurchasesManager : MonoBehaviour
    {
        // ── Singleton ─────────────────────────────────────────────────────
        public static PurchasesManager Instance { get; private set; }

        // ── Inspector ─────────────────────────────────────────────────────
        [Header("RevenueCat API Keys")]
        [SerializeField] private string appleApiKey  = "appl_YOUR_KEY_HERE";
        [SerializeField] private string googleApiKey = "goog_YOUR_KEY_HERE";

        [Header("Product IDs")]
        [SerializeField] private string vipPassId          = "manifestation_vip_pass";
        [SerializeField] private string coins100Id         = "coins_100";
        [SerializeField] private string coins500Id         = "coins_500";
        [SerializeField] private string coins1000Id        = "coins_1000";

        [Header("Entitlement")]
        [SerializeField] private string vipEntitlementId  = "vip";

        // ── Events ────────────────────────────────────────────────────────
        public static event Action<bool>   OnVIPStatusChanged;   // true = VIP active
        public static event Action<int>    OnCoinsGranted;        // amount granted
        public static event Action<string> OnPurchaseError;       // human-readable message

        // ── Unity ─────────────────────────────────────────────────────────
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            InitialiseRevenueCat();
        }

        // ── Initialisation ────────────────────────────────────────────────
        private void InitialiseRevenueCat()
        {
#if UNITY_ANDROID
            string apiKey = googleApiKey;
#elif UNITY_IOS
            string apiKey = appleApiKey;
#else
            // Editor / PC: use Google key for testing
            string apiKey = googleApiKey;
#endif
            Purchases.PurchasesConfiguration.Builder builder =
                Purchases.PurchasesConfiguration.Builder.Init(apiKey);

            Purchases.PurchasesConfiguration config = builder.Build();
            Purchases.Purchases.Configure(config);

            Debug.Log("[RevenueCat] SDK initialised.");

            // Immediately check existing entitlements
            RefreshCustomerInfo();
        }

        // ── Public API ────────────────────────────────────────────────────
        /// <summary>Refresh customer info and update VIP flag.</summary>
        public void RefreshCustomerInfo()
        {
            Purchases.Purchases.SharedPurchases.GetCustomerInfo((info, error) =>
            {
                if (error != null)
                {
                    Debug.LogWarning($"[RevenueCat] CustomerInfo error: {error.Message}");
                    return;
                }
                ProcessCustomerInfo(info);
            });
        }

        /// <summary>Purchase the VIP pass subscription/one-time product.</summary>
        public void PurchaseVIPPass()
        {
            FetchOfferings(offerings =>
            {
                var pkg = FindPackage(offerings, vipPassId);
                if (pkg == null) { OnPurchaseError?.Invoke("VIP Pass not found in offerings."); return; }

                Purchases.Purchases.SharedPurchases.PurchasePackage(pkg, (productIdentifier, info, userCancelled, error) =>
                {
                    if (userCancelled) return;
                    if (error != null) { OnPurchaseError?.Invoke(error.Message); return; }
                    ProcessCustomerInfo(info);
                });
            });
        }

        /// <summary>Purchase a coin bundle by product ID.</summary>
        public void PurchaseCoins(int amount)
        {
            string productId = amount switch
            {
                100  => coins100Id,
                500  => coins500Id,
                1000 => coins1000Id,
                _    => null
            };

            if (productId == null) { Debug.LogError("[RevenueCat] Unknown coin bundle: " + amount); return; }

            FetchOfferings(offerings =>
            {
                var pkg = FindPackage(offerings, productId);
                if (pkg == null) { OnPurchaseError?.Invoke($"Coin bundle {amount} not found."); return; }

                Purchases.Purchases.SharedPurchases.PurchasePackage(pkg, (productIdentifier, info, userCancelled, error) =>
                {
                    if (userCancelled) return;
                    if (error != null) { OnPurchaseError?.Invoke(error.Message); return; }
                    // Non-consumable coins: grant locally, backend should validate receipt
                    Core.GameState.CoinBalance += amount;
                    OnCoinsGranted?.Invoke(amount);
                    Debug.Log($"[RevenueCat] Granted {amount} coins. Total: {Core.GameState.CoinBalance}");
                });
            });
        }

        /// <summary>Restore previous purchases (required for iOS App Store approval).</summary>
        public void RestorePurchases()
        {
            Purchases.Purchases.SharedPurchases.RestorePurchases((info, error) =>
            {
                if (error != null) { OnPurchaseError?.Invoke(error.Message); return; }
                ProcessCustomerInfo(info);
                Debug.Log("[RevenueCat] Purchases restored.");
            });
        }

        // ── Private helpers ────────────────────────────────────────────────
        private void ProcessCustomerInfo(Purchases.CustomerInfo info)
        {
            bool isVIP = info.Entitlements.Active.ContainsKey(vipEntitlementId);
            Core.GameState.IsVIP = isVIP;
            OnVIPStatusChanged?.Invoke(isVIP);
            Debug.Log($"[RevenueCat] VIP status: {isVIP}");
        }

        private void FetchOfferings(Action<Purchases.Offerings> callback)
        {
            Purchases.Purchases.SharedPurchases.GetOfferings((offerings, error) =>
            {
                if (error != null || offerings == null)
                {
                    OnPurchaseError?.Invoke(error?.Message ?? "No offerings available.");
                    return;
                }
                callback(offerings);
            });
        }

        private static Purchases.Package FindPackage(Purchases.Offerings offerings, string productId)
        {
            if (offerings.Current == null) return null;
            foreach (var pkg in offerings.Current.AvailablePackages)
                if (pkg.Product.Identifier == productId) return pkg;
            return null;
        }
    }
}
