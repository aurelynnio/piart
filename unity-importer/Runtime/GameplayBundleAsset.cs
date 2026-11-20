using System.Collections.Generic;
using UnityEngine;

namespace AIPixelStudio.Runtime
{
    public class GameplayBundleAsset : ScriptableObject
    {
        public string stableId;
        public string rawJson;
        public List<StateFlagEntry> stateFlags = new List<StateFlagEntry>();
        public List<DialogueGraphEntry> dialogues = new List<DialogueGraphEntry>();
        public List<QuestDefinitionEntry> quests = new List<QuestDefinitionEntry>();

        public DialogueGraphEntry FindDialogueByNpc(string npcAssetId)
        {
            return dialogues.Find(d => d.npcAssetId == npcAssetId);
        }

        public QuestDefinitionEntry FindQuestById(string questId)
        {
            return quests.Find(q => q.questId == questId);
        }
    }
}
