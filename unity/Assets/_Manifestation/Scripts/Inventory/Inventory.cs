using System;
using System.Collections.Generic;
using UnityEngine;

namespace Manifestation.Inventory
{
    /// <summary>
    /// Hotbar-style inventory for the player's equipment items.
    /// Slots are indexed 0-3 (mapped to keys 1-4).
    /// Items are represented by ItemData ScriptableObjects.
    ///
    /// Think of this like a tool belt with 4 pouches — the player
    /// can only hold one item at a time (active slot) and swap between them.
    /// </summary>
    public class Inventory : MonoBehaviour
    {
        // ── Constants ──────────────────────────────────────────────────────
        public const int SLOT_COUNT = 4;

        // ── Static events ──────────────────────────────────────────────────
        /// <summary>Item added to the hotbar. (slotIndex, item)</summary>
        public static event Action<int, ItemData> OnItemAdded;
        /// <summary>Active slot changed. (newSlotIndex, item)</summary>
        public static event Action<int, ItemData> OnSlotChanged;
        /// <summary>Item used/consumed from a slot. (slotIndex)</summary>
        public static event Action<int>           OnItemUsed;

        // ── Runtime state ──────────────────────────────────────────────────
        private ItemData[] _slots = new ItemData[SLOT_COUNT];
        private int        _activeSlot;

        // ── Properties ─────────────────────────────────────────────────────
        public ItemData ActiveItem  => _slots[_activeSlot];
        public int      ActiveSlot  => _activeSlot;

        // ── Unity ──────────────────────────────────────────────────────────
        private void Update()
        {
            HandleSlotHotkeys();

            // Use active item with Q key
            if (Input.GetKeyDown(KeyCode.Q) && ActiveItem != null)
                UseActiveItem();
        }

        // ── Public API ─────────────────────────────────────────────────────
        /// <summary>
        /// Add an item to the first empty slot.
        /// Returns true if successful, false if inventory is full.
        /// </summary>
        public bool AddItem(ItemData item)
        {
            for (int i = 0; i < SLOT_COUNT; i++)
            {
                if (_slots[i] == null)
                {
                    _slots[i] = item;
                    OnItemAdded?.Invoke(i, item);
                    return true;
                }
            }
            Debug.LogWarning("[Inventory] No empty slot available.");
            return false;
        }

        /// <summary>
        /// Returns true if the player currently has an item with the given ID.
        /// </summary>
        public bool HasItem(string itemId)
        {
            foreach (var slot in _slots)
                if (slot != null && slot.itemId == itemId)
                    return true;
            return false;
        }

        /// <summary>
        /// Remove item by ID (e.g. when a key is "consumed" to open the vault).
        /// </summary>
        public bool RemoveItem(string itemId)
        {
            for (int i = 0; i < SLOT_COUNT; i++)
            {
                if (_slots[i] != null && _slots[i].itemId == itemId)
                {
                    _slots[i] = null;
                    return true;
                }
            }
            return false;
        }

        /// <summary>Switch to a specific hotbar slot index.</summary>
        public void SetActiveSlot(int index)
        {
            if (index < 0 || index >= SLOT_COUNT) return;
            _activeSlot = index;
            OnSlotChanged?.Invoke(_activeSlot, _slots[_activeSlot]);
        }

        // ── Private helpers ────────────────────────────────────────────────
        private void HandleSlotHotkeys()
        {
            for (int i = 0; i < SLOT_COUNT; i++)
            {
                if (Input.GetKeyDown(KeyCode.Alpha1 + i))
                    SetActiveSlot(i);
            }

            // Scroll wheel slot cycling
            float scroll = Input.GetAxis("Mouse ScrollWheel");
            if (scroll > 0f) SetActiveSlot((_activeSlot - 1 + SLOT_COUNT) % SLOT_COUNT);
            if (scroll < 0f) SetActiveSlot((_activeSlot + 1) % SLOT_COUNT);
        }

        private void UseActiveItem()
        {
            if (ActiveItem == null) return;
            Debug.Log($"[Inventory] Used: {ActiveItem.displayName}");
            OnItemUsed?.Invoke(_activeSlot);

            if (ActiveItem.isConsumable)
                _slots[_activeSlot] = null;
        }
    }
}
