using System;
using System.Collections.Generic;

namespace Purchases
{
    public class PurchasesConfiguration
    {
        public class Builder
        {
            private string _apiKey;
            public static Builder Init(string apiKey) => new Builder { _apiKey = apiKey };
            public PurchasesConfiguration Build() => new PurchasesConfiguration();
        }
    }

    public class CustomerInfo
    {
        public EntitlementInfos Entitlements { get; set; } = new EntitlementInfos();
    }

    public class EntitlementInfos
    {
        public Dictionary<string, EntitlementInfo> Active { get; set; } = new Dictionary<string, EntitlementInfo>();
    }

    public class EntitlementInfo { }

    public class PurchasesError
    {
        public string Message { get; set; } = "";
    }

    public class Package
    {
        public StoreProduct Product { get; set; } = new StoreProduct();
    }

    public class StoreProduct
    {
        public string Identifier { get; set; } = "";
    }

    public class Offerings
    {
        public Offering Current { get; set; } = new Offering();
    }

    public class Offering
    {
        public List<Package> AvailablePackages { get; set; } = new List<Package>();
    }

    public class Purchases
    {
        public static Purchases SharedPurchases { get; } = new Purchases();

        public static void Configure(PurchasesConfiguration config) { }

        public void GetCustomerInfo(Action<CustomerInfo, PurchasesError> callback)
        {
            callback?.Invoke(new CustomerInfo(), null);
        }

        public void GetOfferings(Action<Offerings, PurchasesError> callback)
        {
            callback?.Invoke(new Offerings(), null);
        }

        public void PurchasePackage(Package package, Action<string, CustomerInfo, bool, PurchasesError> callback)
        {
            callback?.Invoke(package.Product.Identifier, new CustomerInfo(), false, null);
        }

        public void RestorePurchases(Action<CustomerInfo, PurchasesError> callback)
        {
            callback?.Invoke(new CustomerInfo(), null);
        }
    }
}
