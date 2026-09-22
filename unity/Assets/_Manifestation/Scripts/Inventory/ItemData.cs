using UnityEngine;

namespace Manifestation.Inventory
{
    /// <summary>
    /// ScriptableObject that describes a single inventory item.
    /// Create assets via:  Assets → Create → Manifestation → Item Data
    ///
    /// Think of this as a "blueprint card" for each item in the game.
    /// The Inventory holds references to these cards, not the actual 3D objects.
    /// </summary>
    [CreateAssetMenu(fileName = "NewItem", menuName = "Manifestation/Item Data")]
    public class ItemData : ScriptableObject
    {
        [Header("Identity")]
        public string itemId      = "item_id";
        public string displayName = "New Item";
        [TextArea(2, 4)]
        public string description = "";

        [Header("Visuals")]
        public Sprite icon;          // hotbar icon sprite
        public GameObject worldPrefab; // prefab for dropping in world

        [Header("Behaviour")]
        public bool isConsumable  = false; // removed from slot after use?
        public bool isStackable   = false;
        public int  maxStackSize  = 1;

        [Header("Equipment Type")]
        public ItemType itemType = ItemType.Passive;
    }

    public enum ItemType
    {
        Passive,        // Key, Note  — just carried
        ActiveTool,     // EMF Radar, Thermal Camera — has a use action
        Consumable,     // Battery recharge pack
        QuestItem       // Circuit breaker card, etc.
    }
}
