using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Numerics;
using System.Text;
using WorldSimAPI;
using WorldSimLib.AI;

namespace WorldSimLib
{
    public class ResourceTile : IsometricTile
    {
        public string ResourceType { get; set; }

        public int ResourceQty { get; set; } = 100;

        public int ResourceQtyMax { get; set; } = 100;

        public ResourceTile(int x, int y, int z) : base(x, y, z)
        {
            tileType = "resource";
        }
    }

    public class ObjectTile : IsometricTile
    {
        public ObjectTile(int x, int y, int z, GameObject go) : base(x, y, z)
        {
            GameObject = go;
            tileType = go.Name;
        }

        public GameObject GameObject { get; set; }
    }

    public class BuildingTile : IsometricTile
    {
        public BuildingTile(int x, int y, int z) : base(x, y, z)
        {
            tileType = "building";
            Building = new GameWorkBuilding("Building");
        }

        [JsonProperty]
        public int entranceTile = 0;

        [JsonProperty]
        private bool IsInteriorCreated { get; set; } = false;

        [JsonProperty]
        private InteriorMap interiorMap;

        [JsonProperty]
        public GameWorkBuilding Building { get; set; }

        public InteriorMap InteriorMap { get
            {
                if (IsInteriorCreated == false)
                {
                    interiorMap = new InteriorMap(width * 2, height * 2);
                    IsInteriorCreated = true;
                }

                return interiorMap;
            }
        }


        public Vector3 EntrancePosition
        {
            get
            {
                var entranceX = entranceTile % width;
                var entranceY = entranceTile / width;

                return new Vector3(Position.X + entranceX, Position.Y + entranceY, 0);
            }
        }

        public Vector3 LocalEntrancePosition
        {
            get
            {
                return new Vector3((entranceTile % width) * 2 + 1, (entranceTile / width) * 2 + 1, 0);
            }
        }

        public void CreateInterior()
        {
            if (IsInteriorCreated)
            {
                return;
            }

            interiorMap = new InteriorMap(width*2, height*2);
            IsInteriorCreated = true;
        }
    }

    public class IsometricTile : Tile
    {
        [JsonProperty]
        public string tileType;

        public HeightType HeightType;
        public BiomeType BiomeType;

        [JsonProperty]
        public int width = 1;

        [JsonProperty]
        public int height = 1;

       
        public IsometricTile(int x, int y, int z) : base(x, y, z)
        {
            tileType = "grass";
        }
    }
}
