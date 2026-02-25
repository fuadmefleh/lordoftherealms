using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.Text;
using WorldSimAPI;
using WorldSimLib.AI;
using WorldSimLib.Utils;
using TinkerWorX.AccidentalNoiseLibrary;

namespace WorldSimLib
{
    public class InteriorMap : Map<IsometricTile>
    {
        [JsonProperty]
        public List<ObjectTile> ObjectTiles { get; set; }

        public InteriorMap(int width, int height) : base(width, height)
        {
            Generate();
        }

        public void Generate()
        {
            TileData = new List<IsometricTile>();
            ObjectTiles = new List<ObjectTile>();

            // Create the underlying data representation
            for (int x = 0; x < MapWidth; x++)
            {
                for (int y = 0; y < MapHeight; y++)
                {
                    // All three coords will always sum to zero (z = -x - y)
                    var newTile = new IsometricTile(x, y, 0);

                    newTile.tileType = "grass";

                    TileData.Add(newTile);
                }
            }

            var gameObject = new GameObject("chest");
            gameObject.Inventory.AddToInventory("gold", 10, 1);

            var objectTile = new ObjectTile( 0, 0, 0, gameObject);
            objectTile.width = 2;
            objectTile.height = 1;
            objectTile.tileType = "chest";

            

            ObjectTiles.Add(objectTile);

            ConnectNeighbors();
        }
    }

    public class InnerMap : Map<IsometricTile>
    {
        [JsonProperty]
        public List<ResourceTile> ResourceTiles { get; set; }

        [JsonProperty]
        public List<BuildingTile> BuildingTiles { get; set; }

        public bool IsBuilt
        {
            get { return TileData != null && TileData.Count > 0; }
        }

        public InnerMap(int width, int height) : base(width, height)
        {
            BuildingTiles = new List<BuildingTile>();
            ResourceTiles = new List<ResourceTile>();
        }

        public ResourceTile ResourceTileAtMapPos(int x, int y)
        {
            // Check if the tile is a resource tile and within the bounds of the resource tile
            foreach (var resourceTile in ResourceTiles)
            {
                if (x >= resourceTile.Position.X && x <= resourceTile.Position.X + resourceTile.width &&
                    y >= resourceTile.Position.Y && y <= resourceTile.Position.Y + resourceTile.height)
                {
                    return resourceTile;
                }
            }

            return null;
        }

        public BuildingTile BuildingTileAtMapPos(int x, int y)
        {
            // Check if the tile is a resource tile and within the bounds of the resource tile
            foreach (var buildingTile in BuildingTiles)
            {
                if (x >= buildingTile.Position.X && x < buildingTile.Position.X + buildingTile.width &&
                    y >= buildingTile.Position.Y && y < buildingTile.Position.Y + buildingTile.height)
                {
                    return buildingTile;
                }
            }

            return null;
        }

        public void Generate(HeightType heightType, BiomeType biomeType)
        {
            TileData = new List<IsometricTile>();

            string baseTileType = "grass";

            if (biomeType == BiomeType.SeasonalForest || biomeType == BiomeType.TemperateRainforest ||
                biomeType == BiomeType.Woodland || biomeType == BiomeType.Grassland )
            {
                baseTileType = "grass";
            }
            else if (biomeType == BiomeType.Desert)
            {
                baseTileType = "sand";
            }
            else if (biomeType == BiomeType.Tundra || biomeType == BiomeType.BorealForest)
            {
                baseTileType = "snow";
            }
            else if (biomeType == BiomeType.Savanna)
            {
                baseTileType = "dirt";
            }
            else if (biomeType == BiomeType.Ice)
            {
                baseTileType = "ice";
            }
            else if (biomeType == BiomeType.TropicalRainforest)
            {
                baseTileType = "jungle";
            }

            if( heightType == HeightType.DeepWater )
            {
                baseTileType = "deep_water";
            }
            else if( heightType == HeightType.ShallowWater )
            {
                baseTileType = "shallow_water";
            }
            else if( heightType == HeightType.Sand )
            {
                baseTileType = "sand";
            }

            
            // Create the underlying data representation
            for (int x = 0; x < MapWidth; x++)
            {
                for (int y = 0; y < MapHeight; y++)
                {
                    // All three coords will always sum to zero (z = -x - y)
                    var newTile = new IsometricTile(x, y, 0);

                    newTile.tileType = baseTileType;

                    if (heightType != HeightType.DeepWater && heightType != HeightType.ShallowWater)
                    {
                        // We want a strip of dirt in the middle of the map, across the x axis and y axis
                        if (x == MapWidth / 2 || y == MapHeight / 2)
                        {
                            newTile.tileType = "dirt";
                        }
                    }

                    TileData.Add(newTile);
                }
            }
        }

        public void Create(HeightType heightType, BiomeType biomeType)
        {
            Generate( heightType, biomeType);

            // TODO:
            // Step 1: Fill the map with trees
            // Step 2: Clear a circle space in the center, 20 tiles in diameter
            // Step 3: Place a building in the center of the map
            if (heightType != HeightType.DeepWater && heightType != HeightType.ShallowWater)
            {
                CreateBelievableForest();
                CreateStones();
            }

            

            // Put a test building in the middle of the map
            int houseWidth = 6;
            int houseHeight = 7;

            for (int i = 0; i < 5; i++)
            {
                for (int j = 0; j < 4; j++)
                {
                    var buildingTile = new BuildingTile(MapWidth / 2 + i * houseWidth + 2, MapHeight / 2 + j * houseHeight, 0);
                    buildingTile.tileType = "house";
                    buildingTile.width = 4;
                    buildingTile.height = 5;
                    buildingTile.entranceTile = 18;

                    CreateBuilding(buildingTile);
                }
            }

            ConnectNeighbors();

            // Assign tile types based on the provided height type and biome type
            AssignTileTypes(heightType, biomeType);

            // Sort the resources based on the y position, so the first tree in the list is the one closest to the top of the map
            ResourceTiles.Sort((a, b) => a.Position.Y.CompareTo(b.Position.Y));
        }

        private bool IsInsideCircle(int x, int y, int centerX, int centerY, int radius)
        {
            int dx = x - centerX;
            int dy = y - centerY;
            return dx * dx + dy * dy <= radius * radius;
        }


        private void ClearCenterCircle(int diameter)
        {
            int radius = diameter / 2;
            int centerX = MapWidth / 2;
            int centerY = MapHeight / 2;

            for (int x = centerX - radius; x <= centerX + radius; x++)
            {
                for (int y = centerY - radius; y <= centerY + radius; y++)
                {
                    if (IsInsideCircle(x, y, centerX, centerY, radius))
                    {
                        RemoveTree(x, y);
                    }
                }
            }
        }

        private void RemoveTree(int x, int y)
        {
            // Find the tile reference
            var forestTile = ResourceTileAtMapPos(x, y);

            if( forestTile != null)
                DeleteResource(forestTile);
        }

        private void FillMapWithTrees()
        {
            int treeWidth = 2;
            int treeHeight = 1;

            int forestXStart = 1;
            int forestYStart = 1;

            for (int x = forestXStart; x < MapWidth; x += treeWidth * 2)
            {
                for (int y = forestYStart; y < MapHeight; y += treeHeight * 2)
                {
                    

                    CreateTree(x, y, treeWidth, treeHeight);
                }
            }
        }

        public void CreateBelievableForest()
        {
            ImplicitFractal forestNoise = new ImplicitFractal(
                FractalType.Multi,
                BasisType.Simplex,
                InterpolationType.Quintic);

            forestNoise.Octaves = 6;
            forestNoise.Frequency = 0.6; // Smoother transition across forest density
            forestNoise.Lacunarity = 2.0;

            // Account for tree dimensions when iterating
            int treeWidth = 2;
            int treeHeight = 1;

            // Stop iteration before we would place trees outside bounds
            int maxX = MapWidth - treeWidth - 1;  // Subtract tree width
            int maxY = MapHeight - treeHeight - 1; // Subtract tree height

            for (int x = 0 + 1; x < maxX; x++)
            {
                for (int y = 0 + 1; y < maxY; y++)
                {
                    double noiseValue = forestNoise.Get(x * 0.05, y * 0.05);

                    // Normalize the noise value to 0-1 range
                    noiseValue = (noiseValue + 1) / 2;

                    if (noiseValue > 0.25f) // Increased baseline for forest density
                    {
                        if (noiseValue > 0.75f)
                        {
                            // Dense forest area
                            if (StaticRandom.Instance.NextDouble() < 0.85f) // 85% chance of tree
                            {
                                CreateTree(x, y, treeWidth, treeHeight);
                            }
                        }
                        else if (noiseValue > 0.35f)
                        {
                            // Medium density
                            if (StaticRandom.Instance.NextDouble() < 0.55f) // 55% chance of tree
                            {
                                CreateTree(x, y, treeWidth, treeHeight);
                            }
                            else if (StaticRandom.Instance.NextDouble() < 0.4f) // 40% chance of undergrowth
                            {
                                //PlaceUndergrowth(x, y);
                            }
                        }
                        else
                        {
                            // Sparse area
                            if (StaticRandom.Instance.NextDouble() < 0.25f) // 25% chance of tree
                            {
                                CreateTree(x, y, treeWidth, treeHeight);
                            }
                            else if (StaticRandom.Instance.NextDouble() < 0.5f) // 50% chance of undergrowth
                            {
                                // PlaceUndergrowth(x, y);
                            }
                        }
                    }
                    else
                    {
                        // Clearing areas
                        if (StaticRandom.Instance.NextDouble() < 0.15f) // 15% chance of undergrowth
                        {
                            //PlaceUndergrowth(x, y);
                        }
                    }
                }
            }
        }

        public void CreateTree(int x, int y, int width, int height)
        {
            // Put a patch of forest in the top left of the map
            var forestTile = new ResourceTile(x, y, 0);
            forestTile.width = width;
            forestTile.height = height;
            forestTile.tileType = "small_tree";
            forestTile.ResourceType = "Wood";

            CreateResource(forestTile);
        }

        public void CreateStone(int x, int y, int width, int height)
        {
            var stoneTile = new ResourceTile(x, y, 0);
            stoneTile.width = width;
            stoneTile.height = height;
            stoneTile.tileType = "small_boulder";
            stoneTile.ResourceType = "Stone";

            CreateResource(stoneTile);
        }

        public void DeleteResource(ResourceTile resourceTile)
        {
            // Update the tiles to be not collidable
            for (int i = 0; i < resourceTile.width; i++)
            {
                for (int j = 0; j < resourceTile.height; j++)
                {
                    var tile = TileAtMapPos((int)resourceTile.Position.X + i, (int)resourceTile.Position.Y + j);

                    // Set the entrance tile to be collidable,
                    // entrance tile is the index of the tile in the building starting at the top left and going left to right
                    tile.Collidable = true;
                }
            }

            ResourceTiles.Remove(resourceTile);
        }

        public void CreateResource(ResourceTile resourceTile)
        {
            // First check if the resource would be within bounds
            if (resourceTile.Position.X < 0 || resourceTile.Position.Y < 0 ||
                resourceTile.Position.X + resourceTile.width > MapWidth ||
                resourceTile.Position.Y + resourceTile.height > MapHeight)
            {
                return; // Resource would be out of bounds
            }

            // Check if any tiles are null or already occupied
            for (int i = 0; i < resourceTile.width; i++)
            {
                for (int j = 0; j < resourceTile.height; j++)
                {
                    var tile = TileAtMapPos((int)resourceTile.Position.X + i, (int)resourceTile.Position.Y + j);

                    if (tile == null || !tile.Collidable)
                    {
                        return; // Tile is null or already occupied
                    }
                }
            }

            // If we get here, all tiles are valid - update them to be not collidable
            for (int i = 0; i < resourceTile.width; i++)
            {
                for (int j = 0; j < resourceTile.height; j++)
                {
                    var tile = TileAtMapPos((int)resourceTile.Position.X + i, (int)resourceTile.Position.Y + j);
                    tile.Collidable = false;
                }
            }

            ResourceTiles.Add(resourceTile);
        }

        public void CreateBuilding(BuildingTile buildingTile)
        {
            // First, clear any trees in the building's footprint
            ClearAreaForBuilding(buildingTile);

            // Put a test building in the middle of the map
            var entranceX = buildingTile.entranceTile % buildingTile.width;
            var entranceY = buildingTile.entranceTile / buildingTile.width;

            // Update the tiles to be not collidable
            for (int i = 0; i < buildingTile.width; i++)
            {
                for (int j = 0; j < buildingTile.height; j++)
                {
                    var tile = TileAtMapPos((int)buildingTile.Position.X + i, (int)buildingTile.Position.Y + j);

                    // Set the entrance tile to be collidable,
                    // entrance tile is the index of the tile in the building starting at the top left and going left to right
                    if (i == entranceX && j == entranceY)
                    {
                        tile.Collidable = true;
                    }
                    else
                    {
                        tile.Collidable = false;
                    }
                }
            }

            BuildingTiles.Add(buildingTile);
        }
        public void CreateStones()
        {
            // Use the same noise approach as forest for natural distribution
            ImplicitFractal stoneNoise = new ImplicitFractal(
                FractalType.Multi,
                BasisType.Simplex,
                InterpolationType.Quintic);

            stoneNoise.Octaves = 4;
            stoneNoise.Frequency = 0.8;
            stoneNoise.Lacunarity = 2.5;

            // Simple iteration through the map
            for (int x = 1; x < MapWidth - 1; x += 3)
            {
                for (int y = 1; y < MapHeight - 1; y += 3)
                {
                    double noiseValue = stoneNoise.Get(x * 0.1, y * 0.1);

                    // Normalize the noise value to 0-1 range
                    noiseValue = (noiseValue + 1) / 2;

                    // Spawn stones based on noise value
                    if (noiseValue > 0.7f)
                    {
                        // Check if we can place a stone here
                        var tile = TileAtMapPos(x, y);
                        if (tile != null && tile.Collidable)
                        {
                            CreateStone(x, y, 1, 1);
                        }
                    }
                }
            }
        }


        private void ClearAreaForBuilding(BuildingTile buildingTile)
        {
            // Add a small buffer around the building (optional)
            int buffer = 1; // tiles of clearance around the building

            for (int x = (int)buildingTile.Position.X - buffer;
                 x < buildingTile.Position.X + buildingTile.width + buffer; x++)
            {
                for (int y = (int)buildingTile.Position.Y - buffer;
                     y < buildingTile.Position.Y + buildingTile.height + buffer; y++)
                {
                    // Remove any trees at this position
                    RemoveTree(x, y);
                }
            }
        }
        private void AssignTileTypes(HeightType heightType, BiomeType biomeType)
        {
            foreach (var tile in TileData)
            {
                // Assign height type
                tile.HeightType = heightType;

                // Assign biome type
                tile.BiomeType = biomeType;

                // Vary the tile type based on the height and biome types
                // This is where you would assign different tile types based on the height and biome types
                // Right now we have grass, snow 

                //// Assign additional properties based on the height type and biome type
                //switch (heightType)
                //{
                //    case HeightType.DeepWater:
                //        tile.Collidable = false;
                //        break;
                //    case HeightType.ShallowWater:
                //        tile.Collidable = false;
                //        break;
                //    case HeightType.Shore:
                //        tile.Collidable = true;
                //        break;
                //    case HeightType.Sand:
                //        tile.Collidable = true;
                //        break;
                //    case HeightType.Dirt:
                //        tile.Collidable = true;
                //        break;
                //    case HeightType.Grass:
                //        tile.Collidable = true;
                //        break;
                //    case HeightType.Forest:
                //        tile.Collidable = true;
                //        break;
                //    case HeightType.Rock:
                //        tile.Collidable = true;
                //        break;
                //    case HeightType.Snow:
                //        tile.Collidable = true;
                //        break;
                //    // Add more cases for other height types as needed
                //    default:
                //        tile.Collidable = true;
                //        break;
                //}

                //switch (biomeType)
                //{
                //    case BiomeType.Ocean:
                //        // Assign properties specific to the Ocean biome
                //        break;
                //    case BiomeType.Grassland:
                //        // Assign properties specific to the Grassland biome
                //        break;
                //    case BiomeType.Desert:
                //        // Assign properties specific to the Desert biome
                //        break;
                //    case BiomeType.Tundra:
                //        // Assign properties specific to the Tundra biome
                //        break;
                //    case BiomeType.BorealForest:
                //        // Assign properties specific to the Boreal Forest biome
                //        break;
                //    // Add more cases for other biome types as needed
                //    default:
                //        break;
                //}
            }
        }
    }
}