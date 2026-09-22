using System.Collections;
using UnityEngine;

namespace Manifestation.Maze
{
    public class SlidingDoor : MonoBehaviour
    {
        [Header("Door Mesh & Offset")]
        [SerializeField] private Transform doorMeshTransform;
        [SerializeField] private Vector3 openOffset = new Vector3(0f, -3.8f, 0f);
        [SerializeField] private float slideSpeed = 3.5f;

        [Header("Audio")]
        [SerializeField] private AudioSource audioSource;
        [SerializeField] private AudioClip slideClip;

        private Vector3 closedPosition;
        private Vector3 openPosition;
        private bool isOpen = false;
        private Coroutine activeSlideRoutine;

        private void Awake()
        {
            if (doorMeshTransform == null) doorMeshTransform = transform;
            closedPosition = doorMeshTransform.localPosition;
            openPosition = closedPosition + openOffset;
        }

        public void SetDoorOpen(bool open)
        {
            if (isOpen == open) return;
            isOpen = open;

            if (activeSlideRoutine != null) StopCoroutine(activeSlideRoutine);
            activeSlideRoutine = StartCoroutine(SlideRoutine(isOpen ? openPosition : closedPosition));

            if (audioSource != null && slideClip != null)
            {
                audioSource.PlayOneShot(slideClip, 0.75f);
            }
        }

        private IEnumerator SlideRoutine(Vector3 targetPos)
        {
            while (Vector3.Distance(doorMeshTransform.localPosition, targetPos) > 0.01f)
            {
                doorMeshTransform.localPosition = Vector3.MoveTowards(
                    doorMeshTransform.localPosition,
                    targetPos,
                    slideSpeed * Time.deltaTime
                );
                yield return null;
            }
            doorMeshTransform.localPosition = targetPos;
            activeSlideRoutine = null;
        }

        public bool IsOpen => isOpen;
    }
}
