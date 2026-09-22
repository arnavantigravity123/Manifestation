using System;
using UnityEngine;
// RevenueCat Unity SDK — Unity 6 compatible (v5.x+)
// Install: Window → Package Manager → Add from Git URL:
// https://github.com/RevenueCat/purchases-unity.git
// Make sure to use SDK version 5.2.0 or higher for Unity 6 support.
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
    /// Unity 6 note: RevenueCat SDK 5.x is fully compatible with Unity 6.
    /// Make sure to install the SDK via Package Manager (not Asset Store).
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
        [SerializeField] private string vipPassId   = "manifestation_vip_pass";
        [SerializeField] private string coins100Id  = "coins_100";
        [SerializeField] private string coins500Id  = "coins_500";
        [SerializeField] private string coins1000Id = "coins_1000";

        [Header("Entitlement")]
        [SerializeField] private string vipEntitlementId = "vip";

        // ── Events ────────────────────────────────────────────────────────
        public static event Action<bool>   OnVIPStatusChanged;
        public static event Action<int>    OnCoinsGranted;
        public static event Action<string> OnPurchaseError;

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
            string apiKey = googleApiKey; // Editor fallback
#endif
            // Unity 6 compatible initialisation (RevenueCat SDK 5.x)
            var builder = PurchasesConfiguration.Builder.Init(apiKey);
            Purchases.Purchases.Configure(builder.Build());

            Debug.Log("[RevenueCat] SDK initialised (Unity 6 mode).");
            RefreshCustomerInfo();
        }

        // ── Public API ────────────────────────────────────────────────────
        public void RefreshCustomerInfo()
        {
            Purchases.Purchases.SharedPurchases.GetCustomerInfo((info, error) =>
            {
                if (error != null) { Debug.LogWarning($"[RevenueCat] {error.Message}"); return; }
                ProcessCustomerInfo(info);
            });
        }

        public void PurchaseVIPPass()
        {
            FetchOfferings(offerings =>
            {
                var pkg = FindPackage(offerings, vipPassId);
                if (pkg == null) { OnPurchaseError?.Invoke("VIP Pass not found."); return; }
                Purchases.Purchases.SharedPurchases.PurchasePackage(pkg,
                    (id, info, cancelled, error) =>
                    {
                        if (cancelled) return;
                        if (error != null) { OnPurchaseError?.Invoke(error.Message); return; }
                        ProcessCustomerInfo(info);
                    });
            });
        }

        public void PurchaseCoins(int amount)
        {
            string productId = amount switch { 100 => coins100Id, 500 => coins500Id, 1000 => coins1000Id, _ => null };
            if (productId == null) return;

            FetchOfferings(offerings =>
            {
                var pkg = FindPackage(offerings, productId);
                if (pkg == null) { OnPurchaseError?.Invoke($"Bundle {amount} not found."); return; }
                Purchases.Purchases.SharedPurchases.PurchasePackage(pkg,
                    (id, info, cancelled, error) =>
                    {
                        if (cancelled || error != null) return;
                        Core.GameState.CoinBalance += amount;
                        OnCoinsGranted?.Invoke(amount);
                    });
            });
        }

        public void RestorePurchases()
        {
            Purchases.Purchases.SharedPurchases.RestorePurchases((info, error) =>
            {
                if (error != null) { OnPurchaseError?.Invoke(error.Message); return; }
                ProcessCustomerInfo(info);
            });
        }

        // ── Helpers ───────────────────────────────────────────────────────
        private void ProcessCustomerInfo(CustomerInfo info)
        {
            bool isVIP = info.Entitlements.Active.ContainsKey(vipEntitlementId);
            Core.GameState.IsVIP = isVIP;
            OnVIPStatusChanged?.Invoke(isVIP);
        }

        private void FetchOfferings(Action<Offerings> callback)
        {
            Purchases.Purchases.SharedPurchases.GetOfferings((offerings, error) =>
            {
                if (error != null || offerings == null) { OnPurchaseError?.Invoke(error?.Message ?? "No offerings"); return; }
                callback(offerings);
            });
        }

        private static Package FindPackage(Offerings offerings, string productId)
        {
            if (offerings.Current == null) return null;
            foreach (var pkg in offerings.Current.AvailablePackages)
                if (pkg.Product.Identifier == productId) return pkg;
            return null;
        }
    }
}
