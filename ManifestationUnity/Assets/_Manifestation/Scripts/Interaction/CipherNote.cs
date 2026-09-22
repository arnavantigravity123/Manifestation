using UnityEngine;
using System;

namespace Manifestation.Interaction
{
    public class CipherNote : MonoBehaviour, IInteractable
    {
        [Header("Clue Content")]
        [SerializeField] private string digitClue = "3";
        [SerializeField] private string noteTitle = "Operative Field Note";

        public static event Action<string, string> OnNoteInspected;

        public string GetInteractionPrompt()
        {
            return "Press [E] to Read Clue Note";
        }

        public bool CanInteract()
        {
            return true;
        }

        public void Interact(GameObject instigator)
        {
            OnNoteInspected?.Invoke(noteTitle, $"Recovered Code Fragment: [{digitClue}]");
        }
    }
}
