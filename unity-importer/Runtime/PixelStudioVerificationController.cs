using UnityEngine;

namespace AIPixelStudio.Runtime
{
    public class PixelStudioVerificationController : MonoBehaviour
    {
        public Animator npcAnimator;
        public GameplayBundleAsset gameplayBundle;
        public string activeNpcAssetId = "character_carpenter";
        public string currentDirection = "down";
        public string activeDialoguePreview;

        public void SetDirection(string direction)
        {
            currentDirection = direction;
            if (npcAnimator == null) return;
            switch (direction)
            {
                case "left":
                    npcAnimator.SetFloat("DirX", -1f);
                    npcAnimator.SetFloat("DirY", 0f);
                    break;
                case "right":
                    npcAnimator.SetFloat("DirX", 1f);
                    npcAnimator.SetFloat("DirY", 0f);
                    break;
                case "up":
                    npcAnimator.SetFloat("DirX", 0f);
                    npcAnimator.SetFloat("DirY", 1f);
                    break;
                default:
                    npcAnimator.SetFloat("DirX", 0f);
                    npcAnimator.SetFloat("DirY", -1f);
                    break;
            }
        }

        public string ReadNpcStartLine()
        {
            if (gameplayBundle == null) return string.Empty;
            var dlg = gameplayBundle.FindDialogueByNpc(activeNpcAssetId);
            if (dlg == null || dlg.nodes.Count == 0) return string.Empty;
            var start = dlg.nodes.Find(n => n.nodeId == dlg.startNodeId) ?? dlg.nodes[0];
            activeDialoguePreview = start.text;
            return start.text;
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.LeftArrow) || Input.GetKeyDown(KeyCode.A)) SetDirection("left");
            else if (Input.GetKeyDown(KeyCode.RightArrow) || Input.GetKeyDown(KeyCode.D)) SetDirection("right");
            else if (Input.GetKeyDown(KeyCode.UpArrow) || Input.GetKeyDown(KeyCode.W)) SetDirection("up");
            else if (Input.GetKeyDown(KeyCode.DownArrow) || Input.GetKeyDown(KeyCode.S)) SetDirection("down");
            else if (Input.GetKeyDown(KeyCode.E)) ReadNpcStartLine();
        }
    }
}
