using UnityEngine;
using UnityEngine.UI;
using TMPro;
using Manifestation.Inventory;

namespace Manifestation.UI
{
    /// <summary>
    /// Hotbar UI — renders the 4 inventory slots at the bottom of the screen.
    /// Listens to Inventory events and updates slot icons, highlight, and item count.
    /// </summary>
    public class HotbarUI : MonoBehaviour
    {
        // ── Inspector ─────────────────────────────────────────────────────
        [Header("Slot References (4 slots)")]
        [SerializeField] private HotbarSlotUI[] slots;  // drag 4 slot UI objects here

        [Header("Slot Active Style")]
        [SerializeField] private Color activeSlotColor  = new Color(1f, 0.85f, 0.1f, 1f);
        [SerializeField] private Color inactiveSlotColor = new Color(0.2f, 0.2f, 0.2f, 0.8f);

        // ── Cached ref ────────────────────────────────────────────────────
        private Inventory.Inventory _inventory;

        // ── Unity ─────────────────────────────────────────────────────────
        private void OnEnable()
        {
            Inventory.Inventory.OnItemAdded   += HandleItemAdded;
            Inventory.Inventory.OnSlotChanged += HandleSlotChanged;
            Inventory.Inventory.OnItemUsed    += HandleItemUsed;
        }

        private void OnDisable()
        {
            Inventory.Inventory.OnItemAdded   -= HandleItemAdded;
            Inventory.Inventory.OnSlotChanged -= HandleSlotChanged;
            Inventory.Inventory.OnItemUsed    -= HandleItemUsed;
        }

        private void Start()
        {
            var playerGO = GameObject.FindGameObjectWithTag("Player");
            if (playerGO != null) _inventory = playerGO.GetComponent<Inventory.Inventory>();

            RefreshAll();
        }

        // ── Event handlers ────────────────────────────────────────────────
        private void HandleItemAdded(int slotIndex, ItemData item)   => RefreshSlot(slotIndex, item);
        private void HandleItemUsed(int slotIndex)                    => RefreshSlot(slotIndex, null);
        private void HandleSlotChanged(int slotIndex, ItemData item)
        {
            // Update highlight on all slots
            for (int i = 0; i < slots.Length; i++)
            {
                if (slots[i] == null) continue;
                slots[i].SetHighlight(i == slotIndex ? activeSlotColor : inactiveSlotColor);
            }
        }

        // ── Helpers ────────────────────────────────────────────────────────
        private void RefreshAll()
        {
            if (_inventory == null) return;
            // Inventory doesn't expose _slots directly — we refresh via a query approach
            // In editor you can see what's in each slot from Inventory component
            for (int i = 0; i < Inventory.Inventory.SLOT_COUNT && i < slots.Length; i++)
                RefreshSlot(i, null); // start empty; events will fill in
        }

        private void RefreshSlot(int index, ItemData item)
        {
            if (index < 0 || index >= slots.Length || slots[index] == null) return;
            slots[index].SetItem(item);
        }
    }

    /// <summary>
    /// Visual representation of a single hotbar slot.
    /// Attach to each slot GameObject in the hotbar canvas.
    /// </summary>
    [System.Serializable]
    public class HotbarSlotUI
    {
        public Image    background;
        public Image    iconImage;
        public TMP_Text keyLabel;    // "1", "2", "3", "4"

        public void SetItem(ItemData item)
        {
            bool hasItem = item != null;
            if (iconImage != null)
            {
                iconImage.enabled = hasItem;
                if (hasItem) iconImage.sprite = item.icon;
            }
        }

        public void SetHighlight(Color c)
        {
            if (background != null) background.color = c;
        }
    }
}
