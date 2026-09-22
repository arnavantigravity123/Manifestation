namespace Manifestation.Interaction
{
    public interface IInteractable
    {
        string GetInteractionPrompt();
        void Interact(UnityEngine.GameObject instigator);
        bool CanInteract();
    }
}
